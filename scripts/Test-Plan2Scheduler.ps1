#requires -Version 5.1
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$modulePath = Join-Path $PSScriptRoot 'plan2-scheduler/Plan2Scheduler.psm1'
$entryPoint = Join-Path $PSScriptRoot 'Invoke-Plan2Scheduler.ps1'
$mockSourcePath = Join-Path $PSScriptRoot 'plan2-scheduler/test-fixtures/MockCodex.cs'
Import-Module $modulePath -Force -DisableNameChecking
$suiteRoot = Join-Path $projectRoot ('.scratch/plan2-scheduler-tests/' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($suiteRoot)
$mockPath = Join-Path $suiteRoot 'mock codex.exe'
Add-Type -Path $mockSourcePath -ReferencedAssemblies @('System.Web.Extensions', 'System.Core', 'System') -OutputAssembly $mockPath -OutputType ConsoleApplication
$skillPath = Join-Path $suiteRoot '本机技能/implement/SKILL.md'
$null = [IO.Directory]::CreateDirectory((Split-Path -Parent $skillPath))
[IO.File]::WriteAllText($skillPath, "---`nname: implement`n---`nRead all instructions. 实现、验证、审查、提交。`n", (New-Object Text.UTF8Encoding($true)))
$oldEnvironment = @{}
foreach ($name in @('PLAN2_SCHEDULER_TEST_SKILL', 'PLAN2_SCHEDULER_TEST_MODE')) { $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }
$env:PLAN2_SCHEDULER_TEST_SKILL = $skillPath
$passed = 0
$results = @()

function Assert-That([bool]$Condition, [string]$Message) { if (!$Condition) { throw "Assertion failed: $Message" } }
function New-TestRepository([string]$Name) {
    $root = Join-Path $suiteRoot $Name
    $null = [IO.Directory]::CreateDirectory($root)
    Copy-Item -LiteralPath (Join-Path $projectRoot 'PLAN2.0.md') -Destination $root
    Copy-Item -LiteralPath (Join-Path $projectRoot 'PRD2.0.md') -Destination $root
    $null = & git -C $root init -b scheduler-test 2>&1
    $null = & git -C $root config user.name SchedulerTest
    $null = & git -C $root config user.email scheduler-test@example.invalid
    $null = & git -C $root config core.autocrlf false
    $null = & git -C $root add -- PLAN2.0.md PRD2.0.md
    $null = & git -C $root commit -m 'Fixture baseline' 2>&1
    if ($LASTEXITCODE) { throw 'Could not initialize test repository.' }
    $root
}
function Invoke-TestAction([string]$Root, [string[]]$Extra, [int]$ExpectedExit = 0) {
    $ErrorActionPreference = 'Continue' # Native stderr is data; the expected exit code is checked below.
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $entryPoint -RepositoryRoot $Root -ImplementSkill $skillPath -CodexPath $mockPath @Extra 2>&1)
    $actualExit = $LASTEXITCODE
    if ($actualExit -ne $ExpectedExit) { throw "Expected exit $ExpectedExit, got $actualExit : $($output -join "`n")" }
    $output -join "`n"
}
function Read-TestState([string]$Root) { Get-Content -LiteralPath (Join-Path $Root '.git/plan2-scheduler/state.json') -Raw -Encoding UTF8 | ConvertFrom-Json }
function Start-WaitingTestScheduler([string]$Root) {
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $entryPoint, '-RepositoryRoot', $Root, '-ImplementSkill', $skillPath, '-CodexPath', $mockPath, '-Action', 'Run', '-MaxTasks', '1')
    $quoted = @($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $worker = Start-Process powershell.exe -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Root '.git/scheduler.stdout.log') -RedirectStandardError (Join-Path $Root '.git/scheduler.stderr.log')
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(25)
        do {
            Start-Sleep -Milliseconds 250
            if (Test-Path -LiteralPath (Join-Path $Root '.git/plan2-scheduler/state.json')) {
                $state = Read-TestState $Root
                $activeTask = $state.tasks | Where-Object { $_.status -eq 'running' -and $_.attempts.Count -and $_.attempts[-1].processId } | Select-Object -First 1
                if ($activeTask) { return [pscustomobject]@{ process = $worker; attempt = $activeTask.attempts[-1] } }
            }
        } while (!$worker.HasExited -and [DateTime]::UtcNow -lt $deadline)
        throw 'Fixture worker did not start.'
    } catch {
        if (!$worker.HasExited) { $null = & taskkill.exe /PID $worker.Id /T /F 2>&1 }
        $worker.Dispose()
        throw
    }
}
function Run-Test([string]$Name, [scriptblock]$Body) {
    & $Body
    $script:passed++
    $script:results += [pscustomobject]@{ name = $Name; passed = $true }
    Write-Host "PASS $Name"
}
try {
    Run-Test 'Default repository parameter works without launching Codex' {
        $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $entryPoint -Action Status 2>&1)
        Assert-That ($LASTEXITCODE -eq 0) 'script-root default resolves on PS5.1'
    }
    Run-Test 'Parse 44 tasks and simulate direct dependencies with agent priority' {
        $root = New-TestRepository 'order'
        $null = Invoke-TestAction $root @('-Action', 'Init')
        $context = New-Plan2Context $root $skillPath ''
        $state = Read-TestState $root
        $order = @()
        while ($next = Get-NextPlan2Task $context.tasks $state) {
            foreach ($dependency in $next.dependencies) { Assert-That ($dependency -in $order) "direct dependency $dependency before $($next.id)" }
            $order += $next.id
            ($state.tasks | Where-Object id -eq $next.id).status = 'completed'
        }
        Assert-That ($order.Count -eq 44) 'complete DAG traversal'
        Assert-That (($order[0..10] -join ',') -eq ((1..11 | ForEach-Object { 'T2-{0:D2}' -f $_ }) -join ',')) 'agent milestone first'
        Assert-That ('T2-39' -in @($context.tasks | Where-Object humanRequired | ForEach-Object id)) 'manual UI gate derived from plan'
        Assert-That ('T2-24' -in @($context.tasks | Where-Object humanRequired | ForEach-Object id)) 'AC2-21 mapped desktop manual gate'
        Assert-That (@($context.tasks | Where-Object humanRequired).Count -eq 4) 'composite migration mapping does not force unrelated installation gates'
        Assert-That ('T2-43' -in @($context.tasks | Where-Object humanRequired | ForEach-Object id)) 'real participant gate'
        Assert-That ('T2-44' -in @($context.tasks | Where-Object humanRequired | ForEach-Object id)) 'clean Windows gate'
        $null = Invoke-TestAction $root @('-Action', 'Preview')
        Assert-That (@((Read-TestState $root).tasks | Where-Object status -ne pending).Count -eq 0) 'Init and Preview do not execute'
    }
    Run-Test 'Reject dirty initial worktree and changed plan without launching worker' {
        $root = New-TestRepository 'guards'
        [IO.File]::WriteAllText((Join-Path $root 'existing.txt'), 'Existing user work')
        $null = Invoke-TestAction $root @('-Action', 'Run') 1
        $state = Read-TestState $root
        Assert-That ($state.tasks[0].attempts.Count -eq 0) 'no task started from dirty baseline'
        [IO.File]::AppendAllText((Join-Path $root 'PLAN2.0.md'), "`nPlan changed")
        $null = Invoke-TestAction $root @('-Action', 'Run') 1
        Assert-That ((Read-TestState $root).tasks[0].attempts.Count -eq 0) 'plan hash guard'
    }
    Run-Test 'Two tasks commit with independent sessions and retain artifacts' {
        $root = New-TestRepository 'success'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
        $null = Invoke-TestAction $root @('-Action', 'Run', '-MaxTasks', '2')
        $state = Read-TestState $root
        Assert-That ($state.tasks[0].status -eq 'completed' -and $state.tasks[1].status -eq 'completed' -and $state.tasks[2].status -eq 'pending') 'only two verified tasks released'
        Assert-That ($state.tasks[0].attempts[0].threadId -ne $state.tasks[1].attempts[0].threadId) 'new session IDs'
        foreach ($task in $state.tasks[0..1]) {
            foreach ($file in @('prompt.md', 'implement.SKILL.md', 'events.jsonl', 'stderr.log', 'result.json', 'scheduler-handoff.md')) { Assert-That (Test-Path -LiteralPath (Join-Path $task.attempts[0].directory $file)) "retained $file" }
        }
    }
    foreach ($mode in @('fail', 'unread', 'no-thread', 'missing', 'hash', 'acceptance', 'review', 'no-commit', 'plan-change')) {
        $testMode = $mode
        Run-Test "Pause on $mode; no dependent or independent task is launched" {
            $root = New-TestRepository "gate-$testMode"
            $env:PLAN2_SCHEDULER_TEST_MODE = $testMode
            $null = Invoke-TestAction $root @('-Action', 'Run', '-MaxTasks', '2') 1
            $state = Read-TestState $root
            Assert-That ($state.tasks[0].status -eq 'paused' -and $state.pausedTask -eq 'T2-01') "pause $testMode"
            Assert-That (@($state.tasks | Where-Object { $_.attempts.Count -gt 0 }).Count -eq 1) 'global pause'
            $null = Invoke-TestAction $root @('-Action', 'Run') 1
            Assert-That ((Read-TestState $root).tasks[0].attempts.Count -eq 1) 'no implicit retry'
        }
    }
    Run-Test 'Explicit resume uses a new session with prior handoff after failed exec' {
        $root = New-TestRepository 'resume'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'fail'
        $null = Invoke-TestAction $root @('-Action', 'Run') 1
        $first = (Read-TestState $root).tasks[0].attempts[0]
        # Model a scheduler that was terminated before persisting completion.
        $state = Read-TestState $root
        $state.tasks[0].status = 'running'; $state.pausedTask = ''
        $context = New-Plan2Context $root $skillPath ''
        Save-Plan2State $context $state
        $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
        $null = Invoke-TestAction $root @('-Action', 'Run', '-Resume', '-MaxTasks', '1')
        $task = (Read-TestState $root).tasks[0]
        Assert-That ($task.status -eq 'completed' -and $task.attempts.Count -eq 2) 'interrupted task resumed'
        Assert-That ($task.attempts[1].id -ne $first.id) 'fresh attempt'
        $prompt = Get-Content -LiteralPath (Join-Path $task.attempts[1].directory 'prompt.md') -Raw -Encoding UTF8
        Assert-That ($prompt.Contains($first.directory)) 'previous handoff is pointed to'
    }
    Run-Test 'Evidence mutation blocks starting next task' {
        $root = New-TestRepository 'revalidation'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
        $null = Invoke-TestAction $root @('-Action', 'Run', '-MaxTasks', '1')
        $state = Read-TestState $root
        $result = Get-Content -LiteralPath (Join-Path $state.tasks[0].attempts[0].directory 'result.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        [IO.File]::AppendAllText((Join-Path $root $result.evidence[0].path), 'Altered evidence')
        $null = & git -C $root add -- docs/evidence/plan2
        $null = & git -C $root commit -m 'Alter fixture evidence' 2>&1
        $null = Invoke-TestAction $root @('-Action', 'Run', '-MaxTasks', '1') 1
        Assert-That ((Read-TestState $root).tasks[1].attempts.Count -eq 0) 'completed evidence rechecked'
    }
    Run-Test 'Resume revalidates completed dependency evidence before retrying paused task' {
        $root = New-TestRepository 'resume-evidence'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
        $null = Invoke-TestAction $root @('-Action', 'Run', '-MaxTasks', '1')
        $env:PLAN2_SCHEDULER_TEST_MODE = 'fail'
        $null = Invoke-TestAction $root @('-Action', 'Run', '-MaxTasks', '1') 1
        $state = Read-TestState $root
        $result = Get-Content -LiteralPath (Join-Path $state.tasks[0].attempts[0].directory 'result.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        [IO.File]::AppendAllText((Join-Path $root $result.evidence[0].path), 'Altered evidence')
        $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
        $null = Invoke-TestAction $root @('-Action', 'Run', '-Resume', '-MaxTasks', '1') 1
        Assert-That ((Read-TestState $root).tasks[1].attempts.Count -eq 1) 'resume blocked before new session'
    }
    Run-Test 'Unknown interrupted launch requires explicit recovery and never automatically retries' {
        $root = New-TestRepository 'unknown-launch'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'fail'
        $null = Invoke-TestAction $root @('-Action', 'Run') 1
        $state = Read-TestState $root
        $state.tasks[0].status = 'running'; $state.tasks[0].attempts[0].launchPending = $true
        $state.pausedTask = ''; $state.tasks[0].attempts[0].processId = 0
        Save-Plan2State (New-Plan2Context $root $skillPath '') $state
        $null = Invoke-TestAction $root @('-Action', 'Run', '-Resume') 1
        Assert-That ((Read-TestState $root).tasks[0].attempts.Count -eq 1) 'unknown launch blocks retry'
        $null = Invoke-TestAction $root @('-Action', 'RecoverLaunch', '-TaskId', 'T2-01') 1
        $null = Invoke-TestAction $root @('-Action', 'RecoverLaunch', '-TaskId', 'T2-01', '-NoWorkerConfirmed')
        $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
        $null = Invoke-TestAction $root @('-Action', 'Run', '-Resume', '-MaxTasks', '1')
        Assert-That ((Read-TestState $root).tasks[0].status -eq 'completed') 'explicit launch recovery works'
    }
    Run-Test 'Corrupt state refuses execution without silently resetting tasks' {
        $root = New-TestRepository 'corrupt'
        $null = Invoke-TestAction $root @('-Action', 'Init')
        $path = Join-Path $root '.git/plan2-scheduler/state.json'
        [IO.File]::WriteAllText($path, '{invalid state')
        $null = Invoke-TestAction $root @('-Action', 'Run') 1
        Assert-That (([IO.File]::ReadAllText($path)) -eq '{invalid state') 'corrupt state preserved for inspection'
    }
    Run-Test 'Human gate pauses, rejects wrong signoff, accepts committed human evidence' {
        $root = New-TestRepository 'human'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'human'
        $null = Invoke-TestAction $root @('-Action', 'Run') 1
        $state = Read-TestState $root
        Assert-That ($state.tasks[0].status -eq 'needs_human') 'human gate'
        $null = Invoke-TestAction $root @('-Action', 'Run', '-Resume') 1
        $result = Get-Content -LiteralPath (Join-Path $state.tasks[0].attempts[0].directory 'result.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $relative = 'docs/evidence/plan2/T2-01/human.md'
        [IO.File]::WriteAllText((Join-Path $root $relative), 'Actual fixture reviewer acceptance')
        $null = & git -C $root add -- $relative
        $null = & git -C $root commit -m 'Fixture human evidence' 2>&1
        $record = @{
            approved = $true; reviewer = 'Fixture Reviewer'; acceptedAt = [DateTime]::UtcNow.ToString('o')
            taskId = 'T2-01'; attemptId = 'wrong'; commit = $result.commit; planHash = $state.planHash
            evidence = @(@{ path = $relative; sha256 = (Get-FileHash -LiteralPath (Join-Path $root $relative) -Algorithm SHA256).Hash.ToLowerInvariant() })
        }
        $recordPath = Join-Path $suiteRoot 'human-acceptance.json'
        [IO.File]::WriteAllText($recordPath, ($record | ConvertTo-Json -Depth 10))
        $null = Invoke-TestAction $root @('-Action', 'AcceptHuman', '-TaskId', 'T2-01', '-HumanRecord', $recordPath) 1
        $record.attemptId = $state.tasks[0].attempts[0].id
        [IO.File]::WriteAllText($recordPath, ($record | ConvertTo-Json -Depth 10))
        $null = Invoke-TestAction $root @('-Action', 'AcceptHuman', '-TaskId', 'T2-01', '-HumanRecord', $recordPath)
        Assert-That ((Read-TestState $root).tasks[0].status -eq 'completed') 'operator signoff'
        Assert-That ((Read-TestState $root).tasks[1].attempts.Count -eq 0) 'AcceptHuman does not launch'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
        $null = Invoke-TestAction $root @('-Action', 'Run', '-MaxTasks', '1')
        Assert-That ((Read-TestState $root).tasks[1].status -eq 'completed') 'next task after signoff'
    }
    Run-Test 'Exclusive lock and Stop terminate owned worker, preserve streamed logs and allow resume' {
        $root = New-TestRepository 'stop'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'wait'
        $started = Start-WaitingTestScheduler $root
        $worker = $started.process
        $activeAttempt = $started.attempt
        try {
            $null = Invoke-TestAction $root @('-Action', 'Run') 1
            $null = Invoke-TestAction $root @('-Action', 'Stop')
            Assert-That ($worker.WaitForExit(15000)) 'Stop finishes promptly'
            $state = Read-TestState $root
            Assert-That ($state.tasks[0].status -eq 'paused') 'stopped task paused'
            Assert-That (!(Test-Plan2ChildAlive $activeAttempt)) 'owned process is gone'
            Assert-That ((Get-Item -LiteralPath (Join-Path $activeAttempt.directory 'events.jsonl')).Length -gt 0) 'streamed logs retained'
            $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
            $null = Invoke-TestAction $root @('-Action', 'Run', '-Resume', '-MaxTasks', '1')
            Assert-That ((Read-TestState $root).tasks[0].status -eq 'completed') 'stop/resume completed'
        } finally { if (!$worker.HasExited) { $null = & taskkill.exe /PID $worker.Id /T /F 2>&1 }; $worker.Dispose() }
    }
    Run-Test 'Paused task with a surviving orphan worker blocks resume until owned worker is stopped' {
        $root = New-TestRepository 'paused-live-worker'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'fail'
        $null = Invoke-TestAction $root @('-Action', 'Run') 1
        $state = Read-TestState $root
        $attempt = $state.tasks[0].attempts[0]
        $env:PLAN2_SCHEDULER_TEST_MODE = 'no-input'
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $mockPath; $info.WorkingDirectory = $root
        $info.UseShellExecute = $false; $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
        $orphan = New-Object Diagnostics.Process
        $orphan.StartInfo = $info
        $null = $orphan.Start()
        $attempt.processId = $orphan.Id; $attempt.processStartedAt = $orphan.StartTime.ToUniversalTime().ToString('o')
        Save-Plan2State (New-Plan2Context $root $skillPath '') $state
        try {
            Assert-That (Test-Plan2ChildAlive $attempt) 'orphan worker alive'
            $null = Invoke-TestAction $root @('-Action', 'Run', '-Resume', '-MaxTasks', '1') 1
            Assert-That ((Read-TestState $root).tasks[0].attempts.Count -eq 1) 'no second writer'
            $null = Invoke-TestAction $root @('-Action', 'Stop')
            Assert-That (!(Test-Plan2ChildAlive $attempt)) 'orphan stopped safely'
            $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
            $null = Invoke-TestAction $root @('-Action', 'Run', '-Resume', '-MaxTasks', '1')
            Assert-That ((Read-TestState $root).tasks[0].status -eq 'completed') 'orphan recovery completed'
        } finally {
            if (Test-Plan2ChildAlive $attempt) { Stop-Plan2Child $attempt }
            $orphan.Dispose()
        }
    }
    foreach ($blockedMode in @('no-input', 'inherited-output')) {
        $currentBlockedMode = $blockedMode
        Run-Test "Stop interrupts $blockedMode without waiting forever on pipe I/O" {
            $root = New-TestRepository "blocked-$currentBlockedMode"
            if ($currentBlockedMode -eq 'no-input') {
                $planPath = Join-Path $root 'PLAN2.0.md'
                $plan = [IO.File]::ReadAllText($planPath)
                $plan = $plan.Replace('- [ ] 用固定场景复现', ('- [ ] ' + ('x' * 131072) + '用固定场景复现'))
                [IO.File]::WriteAllText($planPath, $plan, (New-Object Text.UTF8Encoding($false)))
                $null = & git -C $root add -- PLAN2.0.md
                $null = & git -C $root commit -m 'Fixture large prompt' 2>&1
            }
            $env:PLAN2_SCHEDULER_TEST_MODE = $currentBlockedMode
            $started = Start-WaitingTestScheduler $root
            try {
                Start-Sleep -Milliseconds 1000
                $null = Invoke-TestAction $root @('-Action', 'Stop')
                Assert-That ($started.process.WaitForExit(15000)) 'pipe-blocked Stop finishes'
                Assert-That ((Read-TestState $root).tasks[0].status -eq 'paused') 'pipe-blocked task paused'
                if ($currentBlockedMode -eq 'inherited-output') {
                    $descendantPid = [int]([IO.File]::ReadAllText((Join-Path $root '.git/descendant.pid')))
                    Assert-That (!(Get-Process -Id $descendantPid -ErrorAction SilentlyContinue)) 'job removes orphan descendant'
                }
            } finally {
                if (!$started.process.HasExited) { $null = & taskkill.exe /PID $started.process.Id /T /F 2>&1 }
                $started.process.Dispose()
            }
        }
    }
    Run-Test 'Hard-killed scheduler job cleans worker and resume uses a fresh session' {
        $root = New-TestRepository 'hard-kill'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'wait'
        $started = Start-WaitingTestScheduler $root
        try {
            Start-Sleep -Milliseconds 500
            Stop-Process -Id $started.process.Id -Force
            $null = $started.process.WaitForExit(10000)
            Start-Sleep -Milliseconds 500
            Assert-That (!(Test-Plan2ChildAlive $started.attempt)) 'job cleaned worker on parent death'
            $env:PLAN2_SCHEDULER_TEST_MODE = 'success'
            $null = Invoke-TestAction $root @('-Action', 'Run', '-Resume', '-MaxTasks', '1')
            Assert-That ((Read-TestState $root).tasks[0].attempts.Count -eq 2) 'new session after hard kill'
            Assert-That ((Read-TestState $root).tasks[0].status -eq 'completed') 'hard-kill resumed'
        } finally {
            if (!$started.process.HasExited) { $null = & taskkill.exe /PID $started.process.Id /T /F 2>&1 }
            $started.process.Dispose()
        }
    }
    Run-Test 'Stop remains usable after plan becomes invalid during a live task' {
        $root = New-TestRepository 'stop-invalid-plan'
        $env:PLAN2_SCHEDULER_TEST_MODE = 'wait'
        $started = Start-WaitingTestScheduler $root
        try {
            Start-Sleep -Milliseconds 500
            [IO.File]::WriteAllText((Join-Path $root 'PLAN2.0.md'), 'Invalid plan for stop-control regression')
            $null = Invoke-TestAction $root @('-Action', 'Stop')
            Assert-That ($started.process.WaitForExit(15000)) 'Stop bypasses plan parsing'
            Assert-That ((Read-TestState $root).tasks[0].status -eq 'paused') 'invalid-plan task stopped'
        } finally {
            if (!$started.process.HasExited) { $null = & taskkill.exe /PID $started.process.Id /T /F 2>&1 }
            $started.process.Dispose()
        }
    }
    Write-Host "All $passed scheduler tests passed. Fixture artifacts: $suiteRoot"
    [IO.File]::WriteAllText((Join-Path $suiteRoot 'results.json'), ($results | ConvertTo-Json -Depth 10))
} finally {
    foreach ($name in $oldEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name]) }
}
