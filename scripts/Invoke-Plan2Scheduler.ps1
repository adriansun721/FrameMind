#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Init', 'Status', 'Preview', 'Run', 'Stop', 'AcceptHuman', 'RecoverLaunch')]
    [string]$Action = 'Status',
    [string]$RepositoryRoot = '',
    [string]$ImplementSkill = (Join-Path $env:USERPROFILE '.codex/skills/implement/SKILL.md'),
    [string]$CodexPath = 'codex',
    [string]$StateRoot = '',
    [switch]$Resume,
    [ValidateRange(0, 44)][int]$MaxTasks = 0,
    [ValidateRange(1, 10080)][int]$TimeoutMinutes = 240,
    [string]$TaskId = '',
    [string]$HumanRecord = '',
    [switch]$NoWorkerConfirmed
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!$RepositoryRoot) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }
Import-Module (Join-Path $PSScriptRoot 'plan2-scheduler/Plan2Scheduler.psm1') -Force -DisableNameChecking
$lock = $null
$context = $null
try {
    $context = New-Plan2Context $RepositoryRoot $ImplementSkill $StateRoot -ForControlOnly:($Action -eq 'Stop')
    if ($Action -eq 'Stop') {
        $null = [IO.Directory]::CreateDirectory($context.stateRoot)
        [IO.File]::WriteAllText((Join-Path $context.stateRoot 'stop.request'), [DateTime]::UtcNow.ToString('o'))
        # A stop flag is enough for the live scheduler. If its lock is free, clean up an orphan worker.
        try { $lock = [IO.File]::Open($context.lockPath, 'OpenOrCreate', 'ReadWrite', 'None') } catch [IO.IOException] { }
        if ($lock -and (Test-Path -LiteralPath $context.statePath)) {
            $state = Get-Content -LiteralPath $context.statePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($state.repository -ne $context.root -or $state.schemaVersion -ne 1) { throw 'Cannot stop a worker from another repository/schema.' }
            foreach ($task in @($state.tasks | Where-Object { $_.status -ne 'completed' -and $_.attempts.Count -gt 0 })) { Stop-Plan2Child $task.attempts[-1] }
        }
        Write-Host 'Stop requested. Logs and partial work are retained.'
        exit 0
    }
    if ($Action -in @('Init', 'Run', 'AcceptHuman', 'RecoverLaunch')) {
        $null = [IO.Directory]::CreateDirectory($context.stateRoot)
        try { $lock = [IO.File]::Open($context.lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
        catch [IO.IOException] { throw 'Another scheduler owns this state directory.' }
    }
    if ($Action -eq 'Init') { $null = Initialize-Plan2State $context; exit 0 }
    if (!(Test-Path -LiteralPath $context.statePath)) {
        if ($Action -eq 'Run') { $state = Initialize-Plan2State $context }
        elseif ($Action -in @('Status', 'Preview')) {
            Write-Host 'Not initialized. All 44 PLAN tasks are pending. Init/Run creates state.'
            if ($Action -eq 'Preview') {
                $context.tasks | Sort-Object priority, id | Select-Object id, title, dependencies, humanRequired | Format-Table -AutoSize
            }
            exit 0
        } else { throw 'Initialize state first.' }
    } else { $state = Get-Content -LiteralPath $context.statePath -Raw -Encoding UTF8 | ConvertFrom-Json }
    Assert-Plan2State $context $state
    switch ($Action) {
        'Status' {
            Write-Host "State: $($context.statePath)"
            Write-Host "Paused task: $($state.pausedTask) $($state.reason)"
            $state.tasks | Select-Object id, status, completedCommit | Format-Table -AutoSize
        }
        'Preview' {
            # Simulate the exact sequential priority/topological order without executing Codex.
            $simulation = $state | ConvertTo-Json -Depth 40 | ConvertFrom-Json
            if ($simulation.pausedTask) { Write-Host "Paused task must be resolved first: $($simulation.pausedTask)" }
            $order = 0
            while ($next = Get-NextPlan2Task $context.tasks $simulation) {
                $order++
                [pscustomobject]@{ order = $order; id = $next.id; title = $next.title; dependencies = ($next.dependencies -join ','); humanRequired = $next.humanRequired }
                ($simulation.tasks | Where-Object id -eq $next.id).status = 'completed'
            }
        }
        'Run' { Invoke-Plan2Schedule $context $state $CodexPath -Resume:$Resume -MaxTasks $MaxTasks -TimeoutMinutes $TimeoutMinutes }
        'RecoverLaunch' {
            if (!$TaskId -or !$NoWorkerConfirmed) { throw 'RecoverLaunch requires -TaskId and -NoWorkerConfirmed after inspecting/ending all orphan workers for this attempt.' }
            $task = $state.tasks | Where-Object id -eq $TaskId
            if (!$task -or !$task.attempts.Count -or !$task.attempts[-1].launchPending) { throw 'No unresolved launch for this task.' }
            $attempt = $task.attempts[-1]
            $resultPath = Join-Path $attempt.directory 'result.json'
            $orphans = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($resultPath) })
            if ($orphans.Count -or (Test-Plan2ChildAlive $attempt)) { throw 'Matching worker is still alive. End it before acknowledging launch recovery.' }
            $attempt.launchPending = $false; $task.status = 'paused'; $state.pausedTask = $TaskId
            $state.reason = 'Operator confirmed interrupted launch has no surviving worker; inspect partial work, then Run -Resume.'
            Write-Plan2Handoff $context $task $attempt $state.reason
            Save-Plan2State $context $state
            Add-Plan2Event $context $state.reason
        }
        'AcceptHuman' {
            if (!$HumanRecord -or !$TaskId -or $state.pausedTask -ne $TaskId) { throw 'AcceptHuman requires -TaskId for the paused task and -HumanRecord JSON path.' }
            $task = $state.tasks | Where-Object id -eq $TaskId
            if ($task.status -ne 'needs_human') { throw 'Task is not awaiting human acceptance; incomplete checkboxes require a new Run -Resume attempt.' }
            $definition = $context.tasks | Where-Object id -eq $TaskId
            $checked = Assert-Plan2Result $context $task $definition $task.attempts[-1] -AllowHuman
            $record = Get-Content -LiteralPath $HumanRecord -Raw -Encoding UTF8 | ConvertFrom-Json
            Assert-Plan2HumanRecord $context $task $checked.result $record
            $destination = Join-Path $task.attempts[-1].directory 'human-acceptance.json'
            [IO.File]::WriteAllText($destination, ($record | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
            $task.humanRecord = $destination; $task.status = 'completed'
            $task.completedCommit = (& git -C $context.root rev-parse HEAD).Trim()
            $state.pausedTask = ''; $state.reason = ''
            Save-Plan2State $context $state
            Add-Plan2Event $context "Human acceptance recorded for $TaskId. Next task requires explicit Run."
        }
    }
} catch {
    if ($lock -and $context) { Add-Plan2Event $context "$Action refused/failed: $($_.Exception.Message)" }
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally { if ($lock) { $lock.Dispose() } }
