Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-AtomicText {
    param([string]$Path, [string]$Text)
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllText($temporary, $Text, $script:Utf8)
    if (Test-Path -LiteralPath $Path) {
        [IO.File]::Replace($temporary, $Path, "$Path.bak")
    } else { [IO.File]::Move($temporary, $Path) }
}

function Read-Json { param([string]$Path) Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Write-Json { param([string]$Path, $Value) Write-AtomicText $Path ($Value | ConvertTo-Json -Depth 40) }
function Get-Sha256 { param([string]$Path) (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-UtcStamp { [DateTime]::UtcNow.ToString('o') }

function Invoke-RepositoryGit {
    param([string]$Root, [string[]]$Arguments)
    $output = @(& git -C $Root @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
    ($output -join "`n").Trim()
}

function Get-Plan2Tasks {
    param([string]$PlanPath)
    $text = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8
    $humanTasks = @()
    foreach ($mapping in [regex]::Matches($text, '(?m)^\| AC2-\d+ \| ([^|]+) \| ([^|]+) \|\s*$')) {
        # Composite mappings also mention migration/installation for different owners.
        # Only their shared manual inspection requirement is inherited by every owner.
        if ($mapping.Groups[2].Value -match '人工(?:视觉)?(?:检查|核查|验收)') {
            $humanTasks += @([regex]::Matches($mapping.Groups[1].Value, 'T2-\d{2}') | ForEach-Object { $_.Value })
        }
    }
    $tasks = @()
    foreach ($row in [regex]::Matches($text, '(?m)^\| (T2-\d{2}) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|\s*$')) {
        $id = $row.Groups[1].Value
        $detail = [regex]::Match($text, "(?ms)^### $id [^\r\n]+\r?\n.*?(?=^### T2-|^## 6\.|\z)").Value
        if (!$detail) { throw "Missing task details: $id" }
        $criteria = @([regex]::Matches($detail, '(?m)^- \[ \] (.+)$') | ForEach-Object { $_.Groups[1].Value.Trim() })
        if (!$criteria.Count) { throw "Missing acceptance criteria: $id" }
        $number = [int]$id.Substring(3)
        $priority = if ($number -le 11 -or $number -eq 41) { 0 } elseif ($number -eq 39) { 2 } else { 1 }
        $tasks += [pscustomobject]@{
            id = $id; title = $row.Groups[2].Value.Trim()
            dependencies = @([regex]::Matches($row.Groups[3].Value, 'T2-\d{2}') | ForEach-Object { $_.Value })
            priority = $priority; criteria = $criteria; detail = $detail
            humanRequired = ($id -in $humanTasks -or $detail -match '真人|干净 Windows|干净系统|人工(?:视觉)?(?:检查|核查|验收)')
        }
    }
    if ($tasks.Count -ne 44 -or @($tasks.id | Select-Object -Unique).Count -ne 44) { throw 'PLAN2.0.md must contain 44 unique tasks.' }
    foreach ($task in $tasks) {
        foreach ($dependency in $task.dependencies) {
            if ($dependency -eq $task.id -or $dependency -notin $tasks.id) { throw "Invalid dependency: $($task.id) -> $dependency" }
        }
    }
    $visited = @()
    while ($visited.Count -lt $tasks.Count) {
        $ready = @($tasks | Where-Object { $_.id -notin $visited -and @($_.dependencies | Where-Object { $_ -notin $visited }).Count -eq 0 })
        if (!$ready.Count) { throw 'Dependency cycle in PLAN2.0.md.' }
        $visited += $ready.id
    }
    $tasks
}

function Get-NextPlan2Task {
    param($Tasks, $State)
    $completed = @($State.tasks | Where-Object status -eq 'completed' | ForEach-Object id)
    $Tasks | Where-Object {
        $_.id -notin $completed -and @($_.dependencies | Where-Object { $_ -notin $completed }).Count -eq 0
    } | Sort-Object priority, id | Select-Object -First 1
}

function Save-Plan2State {
    param($Context, $State)
    $State.updatedAt = Get-UtcStamp
    Write-Json $Context.statePath $State
}

function Add-Plan2Event {
    param($Context, [string]$Message)
    [IO.File]::AppendAllText((Join-Path $Context.stateRoot 'scheduler.jsonl'), ((@{ at = Get-UtcStamp; message = $Message } | ConvertTo-Json -Compress) + "`n"), $script:Utf8)
    Write-Host $Message
}

function New-Plan2Context {
    param([string]$Root, [string]$ImplementSkill, [string]$StateRoot, [switch]$ForControlOnly)
    $Root = [IO.Path]::GetFullPath($Root)
    $gitRoot = Invoke-RepositoryGit $Root @('rev-parse', '--show-toplevel')
    if ([IO.Path]::GetFullPath($gitRoot) -ne $Root) { throw 'RepositoryRoot must be the Git repository root.' }
    $planPath = Join-Path $Root 'PLAN2.0.md'
    $prdPath = Join-Path $Root 'PRD2.0.md'
    if (!$ForControlOnly -and !(Test-Path -LiteralPath $prdPath -PathType Leaf)) { throw 'PRD2.0.md is required.' }
    $gitDir = Invoke-RepositoryGit $Root @('rev-parse', '--absolute-git-dir')
    if (!$StateRoot) {
        $StateRoot = Join-Path $gitDir 'plan2-scheduler'
    }
    [pscustomobject]@{
        root = $Root; planPath = $planPath; prdPath = $prdPath
        planHash = $(if (!$ForControlOnly) { Get-Sha256 $planPath } else { '' })
        prdHash = $(if (!$ForControlOnly) { Get-Sha256 $prdPath } else { '' })
        skillPath = [IO.Path]::GetFullPath($ImplementSkill)
        stateRoot = [IO.Path]::GetFullPath($StateRoot)
        lockPath = Join-Path $gitDir 'plan2-scheduler.lock'
        statePath = Join-Path ([IO.Path]::GetFullPath($StateRoot)) 'state.json'
        tasks = @($(if (!$ForControlOnly) { Get-Plan2Tasks $planPath }))
    }
}

function Initialize-Plan2State {
    param($Context)
    if (Test-Path -LiteralPath $Context.statePath) { throw 'State already exists; use Status, Preview or Run.' }
    $branch = Invoke-RepositoryGit $Context.root @('symbolic-ref', '--short', 'HEAD')
    $state = [pscustomobject]@{
        schemaVersion = 1; repository = $Context.root; branch = $branch
        planHash = $Context.planHash; prdHash = $Context.prdHash
        createdAt = Get-UtcStamp; updatedAt = Get-UtcStamp; pausedTask = ''; reason = ''
        tasks = @($Context.tasks | ForEach-Object {
            [pscustomobject]@{ id = $_.id; status = 'pending'; baseCommit = ''; attempts = @(); completedCommit = ''; humanRecord = '' }
        })
    }
    Save-Plan2State $Context $state
    Write-AtomicText (Join-Path $Context.stateRoot 'PLAN2.0.md') (Get-Content -LiteralPath $Context.planPath -Raw -Encoding UTF8)
    Write-AtomicText (Join-Path $Context.stateRoot 'PRD2.0.md') (Get-Content -LiteralPath $Context.prdPath -Raw -Encoding UTF8)
    Add-Plan2Event $Context 'Initialized 44 pending tasks. No business task launched.'
    $state
}

function Assert-Plan2State {
    param($Context, $State)
    if ($State.schemaVersion -ne 1 -or $State.repository -ne $Context.root) { throw 'State belongs to another repository or schema.' }
    if ($State.planHash -ne (Get-Sha256 $Context.planPath) -or $State.prdHash -ne (Get-Sha256 $Context.prdPath)) { throw 'Plan/PRD changed. Review and migrate state explicitly before continuing.' }
    if ($State.branch -ne (Invoke-RepositoryGit $Context.root @('symbolic-ref', '--short', 'HEAD'))) { throw 'Git branch changed; refusing to continue on another branch.' }
    if (@($State.tasks).Count -ne 44 -or @($State.tasks.id | Select-Object -Unique).Count -ne 44 -or @($State.tasks.id | Where-Object { $_ -notin $Context.tasks.id }).Count) { throw 'Invalid task state inventory.' }
    foreach ($task in $State.tasks) {
        if ($task.status -notin @('pending', 'running', 'paused', 'needs_human', 'completed')) { throw "Invalid status: $($task.id)" }
        if ($task.status -eq 'completed') {
            $definition = $Context.tasks | Where-Object id -eq $task.id
            foreach ($dependency in $definition.dependencies) {
                if (($State.tasks | Where-Object id -eq $dependency).status -ne 'completed') { throw "Completed task has incomplete dependency: $($task.id)" }
            }
        }
    }
}

function Assert-Plan2Clean {
    param($Context)
    if (Invoke-RepositoryGit $Context.root @('status', '--porcelain', '--untracked-files=all')) {
        throw 'Worktree is dirty. Review/commit or move existing changes yourself before Run/AcceptHuman; scheduler never stashes or commits them.'
    }
}

function Resolve-Plan2Evidence {
    param($Context, [string]$RelativePath)
    if (!$RelativePath -or [IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '(^|[\\/])\.git([\\/]|$)|:') { throw "Invalid evidence path: $RelativePath" }
    $absolute = [IO.Path]::GetFullPath((Join-Path $Context.root $RelativePath))
    if (!$absolute.StartsWith($Context.root.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Evidence escapes repository: $RelativePath" }
    if (!(Test-Path -LiteralPath $absolute -PathType Leaf) -or (Get-Item -LiteralPath $absolute).Length -eq 0) { throw "Missing/empty evidence: $RelativePath" }
    $cursor = Get-Item -LiteralPath $absolute
    while ($cursor.FullName -ne $Context.root) {
        if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Evidence follows a reparse point: $RelativePath" }
        $cursor = Get-Item -LiteralPath (Split-Path -Parent $cursor.FullName)
    }
    $absolute
}

function Assert-Plan2SkillRead {
    param($Context, $Attempt)
    $snapshot = Join-Path $Attempt.directory 'implement.SKILL.md'
    if ((Get-Sha256 $snapshot) -ne $Attempt.skillHash) { throw 'Implement skill snapshot hash mismatch.' }
    $skillText = (Get-Content -LiteralPath $snapshot -Raw -Encoding UTF8).Trim().Replace("`r`n", "`n")
    $firstCommand = $null
    $threadId = ''
    foreach ($line in [IO.File]::ReadLines((Join-Path $Attempt.directory 'events.jsonl'), $script:Utf8)) {
        if (![string]::IsNullOrWhiteSpace($line)) {
            $event = $line | ConvertFrom-Json
            if ($event.type -eq 'thread.started') { $threadId = $event.thread_id }
            if ($event.type -eq 'item.completed' -and $event.item.type -eq 'command_execution' -and !$firstCommand) { $firstCommand = $event.item }
        }
    }
    if (!$threadId) { throw 'Missing new-session thread.started event.' }
    if (!$firstCommand -or $firstCommand.exit_code -ne 0 -or $firstCommand.status -ne 'completed') { throw 'First shell command did not successfully read implement.' }
    $command = $firstCommand.command.Replace('/', '\')
    if ($command -notmatch 'Get-Content' -or !$command.Contains($Context.skillPath.Replace('/', '\')) -or !$firstCommand.aggregated_output.Replace("`r`n", "`n").Contains($skillText)) {
        throw 'First shell command lacks a complete read of the configured local implement skill.'
    }
    $threadId
}

function Assert-Plan2Result {
    param($Context, $TaskState, $Definition, $Attempt, [switch]$AllowHuman, [switch]$AllowPartialWorktree)
    if ($Attempt.exitCode -ne 0) { throw "codex exec failed: exit $($Attempt.exitCode)" }
    if ($Context.planHash -ne (Get-Sha256 $Context.planPath) -or $Context.prdHash -ne (Get-Sha256 $Context.prdPath)) { throw 'Plan/PRD changed during task; review baseline before continuing.' }
    $result = Read-Json (Join-Path $Attempt.directory 'result.json')
    if ($result.schemaVersion -ne 1 -or $result.taskId -ne $TaskState.id -or $result.attemptId -ne $Attempt.id) { throw 'Result identity mismatch.' }
    if ($result.outcome -notin @('complete', 'needs_human')) { throw "Task did not complete: $($result.summary)" }
    $threadId = Assert-Plan2SkillRead $Context $Attempt
    if ($result.skill.path -ne $Context.skillPath -or $result.skill.sha256 -ne $Attempt.skillHash) { throw 'Result does not attest to the required implement skill.' }
    if ($result.humanRequired -isnot [bool]) { throw 'humanRequired must be a boolean.' }
    foreach ($phase in @('implementation', 'verification', 'review')) {
        if ($result.$phase.passed -isnot [bool] -or $result.$phase.passed -ne $true) { throw 'Implementation, verification or review gate failed.' }
    }
    if ($result.review.openFindings -isnot [int] -or $result.review.openFindings -ne 0) { throw 'Review must have zero open findings.' }
    if ($result.commit -notmatch '^[0-9a-f]{40}$') { throw 'Full commit SHA is required.' }
    $head = Invoke-RepositoryGit $Context.root @('rev-parse', 'HEAD')
    $null = Invoke-RepositoryGit $Context.root @('merge-base', '--is-ancestor', $result.commit, $head)
    $null = Invoke-RepositoryGit $Context.root @('merge-base', '--is-ancestor', $TaskState.baseCommit, $result.commit)
    if ($result.commit -eq $TaskState.baseCommit) { throw 'Task has no new commit.' }
    if (!$AllowHuman -and $head -ne $result.commit) { throw 'Result commit must be current HEAD.' }
    if (!$AllowPartialWorktree) { Assert-Plan2Clean $Context }
    $changed = (Invoke-RepositoryGit $Context.root @('diff', '--name-only', $TaskState.baseCommit, $result.commit)) -split "`n"
    $evidence = @{}
    foreach ($entry in $result.evidence) {
        if ($evidence.ContainsKey($entry.path) -or $entry.kind -notin @('implementation', 'verification', 'review', 'acceptance', 'human')) { throw 'Duplicate evidence or invalid evidence kind.' }
        $path = Resolve-Plan2Evidence $Context $entry.path
        if ($entry.sha256 -notmatch '^[0-9a-f]{64}$' -or (Get-Sha256 $path) -ne $entry.sha256) { throw "Evidence hash mismatch: $($entry.path)" }
        $gitPath = $entry.path.Replace('\', '/')
        if ($gitPath -notin $changed) { throw "Evidence was not added/updated by this task: $gitPath" }
        $blob = Invoke-RepositoryGit $Context.root @('hash-object', '--', $path)
        if ($blob -ne (Invoke-RepositoryGit $Context.root @('rev-parse', "$($result.commit):$gitPath"))) { throw "Evidence not in task commit: $gitPath" }
        $evidence[$entry.path] = $entry
    }
    foreach ($phase in @('implementation', 'verification', 'review')) {
        $references = @($result.$phase.evidence)
        if (!$references.Count) { throw "Missing $phase evidence." }
        foreach ($reference in $references) {
            if (!$evidence.ContainsKey($reference) -or $evidence[$reference].kind -ne $phase) { throw "Missing/wrong-kind $phase evidence: $reference" }
        }
    }
    if (@($result.acceptance).Count -ne $Definition.criteria.Count) { throw 'Acceptance evidence must cover every PLAN checkbox.' }
    $indices = @()
    foreach ($criterion in $result.acceptance) {
        if ($criterion.index -isnot [int] -or $criterion.index -lt 1 -or $criterion.index -gt $Definition.criteria.Count -or $criterion.index -in $indices -or $criterion.passed -isnot [bool] -or !$criterion.passed -or !@($criterion.evidence).Count) { throw 'Incomplete/duplicate acceptance criterion.' }
        $indices += $criterion.index
        foreach ($reference in $criterion.evidence) { if (!$evidence.ContainsKey($reference)) { throw "Unregistered acceptance evidence: $reference" } }
    }
    if (!$evidence.ContainsKey($result.handoff)) { throw 'Missing committed handoff record.' }
    [pscustomobject]@{ result = $result; threadId = $threadId; needsHuman = ($Definition.humanRequired -or $result.humanRequired -or $result.outcome -eq 'needs_human') }
}

function New-Plan2Prompt {
    param($Context, $State, $Definition, $TaskState, $Attempt)
    $skillLiteral = $Context.skillPath.Replace("'", "''")
    $previous = @($TaskState.attempts | Where-Object id -ne $Attempt.id | ForEach-Object { $_.directory }) -join "`n"
    $dependencies = @($Definition.dependencies | ForEach-Object {
        $dependency = $State.tasks | Where-Object id -eq $_
        "$($dependency.id): commit=$($dependency.completedCommit); attempt=$($dependency.attempts[-1].directory)"
    }) -join "`n"
    $criteria = for ($i = 0; $i -lt $Definition.criteria.Count; $i++) { "$($i + 1). $($Definition.criteria[$i])" }
    @"
`$implement
Explicitly invoke the local implement skill for this task. Your FIRST shell command must be exactly:
Get-Content -LiteralPath '$skillLiteral' -Raw -Encoding UTF8
Read all of its output, then follow the skill. A mention or scheduler snapshot does not count as reading it yourself.

You are implementing ONLY $($Definition.id): $($Definition.title), in a NEW codex exec session.
Read PLAN2.0.md and PRD2.0.md, repository instructions, the task details and shared constraints.
Implement, verify at public boundaries, use the local code-review skill with fixed point $($TaskState.baseCommit) and spec PLAN2.0.md/$($Definition.id), fix findings, then commit only this task on the current branch. The user requested execution from this local plan; no external issue tracker publication is part of this task. Record actual technical decisions, PRD coverage, reproducible inputs/results and limitations. Typecheck regularly and run the full relevant test suite at the end as implement requires.
This is source development; PLAN's runtime agent constraints apply to the product agent, not a prohibition on your implementation work.
Only the listed direct dependencies are prerequisites. Do not implement the next task. Preserve earlier capabilities and evidence. Credential values must stay out of all artifacts and ordinary logs.

Task acceptance (indices used in final result):
$($criteria -join "`n")

Direct dependency handoffs:
$dependencies
Prior attempts (read result, events and scheduler-handoff.md, inspect existing changes/commits before continuing; do not blindly repeat effects):
$previous

Task base commit: $($TaskState.baseCommit)
Attempt start commit: $($Attempt.startCommit)
Attempt ID: $($Attempt.id)
Implement skill SHA256: $($Attempt.skillHash)
Human evidence mandatory from PLAN: $($Definition.humanRequired)

Write nonempty evidence and a handoff under docs/evidence/plan2/$($Definition.id)/ and commit them with the implementation. Evidence must be new/updated since task base commit, and match current files and the reported commit. Include separate implementation, verification (commands, exit status, actual output), review (review scope, findings and resolutions) records and evidence for EVERY numbered checkbox. Screenshots do not replace numerical tests; replay does not replace real AI testing; local install does not replace clean Windows testing.
When blocked, failed, lacking evidence or awaiting a human, stop this task and report the truth. Never fabricate pass evidence. For an implemented/verified/reviewed/committed task with human acceptance still required, use outcome needs_human. PLAN-mandated human gates remain pending until the operator provides an acceptance record. If a checkbox cannot yet pass, report failed or needs_human with passed=false; it cannot advance until completed on a later attempt.
Keep implementation.passed, verification.passed, review.passed and each acceptance.passed honest. Report the full current commit SHA, SHA256 of evidence files, this exact attempt ID, task ID, skill path/hash, and a committed handoff. Return JSON matching the supplied output schema. The scheduler checks logs, files, hashes, every checkbox and commit before releasing dependencies.
Scheduler state is owned by the parent. Keep PLAN2.0.md and PRD2.0.md as unchanged requirement baselines. Do not edit scheduler state, stop flag, snapshots, prompt, events, or result files; your final response is saved by codex. Use the previous attempt artifacts only as read-only context. Do not start another scheduler.
"@
}

function ConvertTo-WindowsArgument {
    param([string]$Value)
    # CommandLineToArgvW rules, including trailing backslashes before the closing quote.
    '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Stop-Plan2Child {
    param($Attempt)
    if (!$Attempt.processId) { return }
    $process = Get-Process -Id $Attempt.processId -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $Attempt.processStartedAt) {
        $null = & taskkill.exe /PID $Attempt.processId /T /F 2>&1
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $Attempt.processId -ErrorAction SilentlyContinue)) { throw "Could not stop owned worker PID $($Attempt.processId)." }
    }
}

function Test-Plan2ChildAlive {
    param($Attempt)
    if (!$Attempt.processId) { return $false }
    $process = Get-Process -Id $Attempt.processId -ErrorAction SilentlyContinue
    $process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $Attempt.processStartedAt
}

function Invoke-Plan2Worker {
    param($Context, $State, $Attempt, [string]$CodexPath, [int]$TimeoutMinutes)
    $arguments = @('exec', '-C', $Context.root, '-s', 'danger-full-access', '-c', 'approval_policy="never"', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"', '--json', '--color', 'never', '--output-schema', (Join-Path $PSScriptRoot 'result.schema.json'), '-o', (Join-Path $Attempt.directory 'result.json'), '-')
    $executable = (Get-Command $CodexPath -ErrorAction Stop).Source
    if ([IO.Path]::GetExtension($executable) -ne '.exe') { throw 'CodexPath must resolve to a native executable (normally codex.exe).' }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $executable
    $info.Arguments = (@($arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ')
    $info.WorkingDirectory = $Context.root
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = $script:Utf8; $info.StandardErrorEncoding = $script:Utf8
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    if (!('Plan2WorkerJob' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'WorkerJob.cs') }
    $job = New-Object Plan2WorkerJob
    $stdoutFile = $null; $stderrFile = $null; $stdoutCopy = $null; $stderrCopy = $null; $inputWrite = $null
    $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
    try {
        $stdoutFile = New-Object IO.FileStream((Join-Path $Attempt.directory 'events.jsonl'), [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::Read, 1, [IO.FileOptions]::WriteThrough)
        $stderrFile = New-Object IO.FileStream((Join-Path $Attempt.directory 'stderr.log'), [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::Read, 1, [IO.FileOptions]::WriteThrough)
        $Attempt.launchPending = $true
        Save-Plan2State $Context $State
        # .NET Framework selects stdin encoding from Console.InputEncoding at Start.
        # Select BOM-free UTF8 before it creates its auto-flushing StreamWriter.
        $previousInputEncoding = [Console]::InputEncoding
        try { [Console]::InputEncoding = $script:Utf8; $null = $process.Start() }
        finally { [Console]::InputEncoding = $previousInputEncoding }
        $Attempt.processId = $process.Id
        $Attempt.processStartedAt = $process.StartTime.ToUniversalTime().ToString('o')
        $job.Attach($process)
        $Attempt.launchPending = $false
        Save-Plan2State $Context $State
        $stdoutCopy = $process.StandardOutput.BaseStream.CopyToAsync($stdoutFile)
        $stderrCopy = $process.StandardError.BaseStream.CopyToAsync($stderrFile)
        $promptBytes = $script:Utf8.GetBytes((Get-Content -LiteralPath (Join-Path $Attempt.directory 'prompt.md') -Raw -Encoding UTF8))
        $inputWrite = $process.StandardInput.BaseStream.WriteAsync($promptBytes, 0, $promptBytes.Length)
        $inputClosed = $false
        while ($true) {
            if (Test-Path -LiteralPath (Join-Path $Context.stateRoot 'stop.request')) { throw 'Operator requested stop.' }
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Worker timeout; task paused.' }
            if ($inputWrite.IsCompleted -and !$inputClosed) {
                $null = $inputWrite.GetAwaiter().GetResult()
                $process.StandardInput.Close()
                $inputClosed = $true
            }
            $exited = $process.WaitForExit(100)
            if ($exited -and $inputClosed -and $stdoutCopy.IsCompleted -and $stderrCopy.IsCompleted) { break }
            if ($exited) { Start-Sleep -Milliseconds 100 }
        }
        $null = $stdoutCopy.GetAwaiter().GetResult(); $null = $stderrCopy.GetAwaiter().GetResult()
        $Attempt.exitCode = $process.ExitCode
    } finally {
        # Closing the job stops orphan descendants holding redirected pipe handles.
        $job.Dispose()
        if ($Attempt.processId) { Stop-Plan2Child $Attempt }
        foreach ($copy in @($inputWrite, $stdoutCopy, $stderrCopy)) {
            if ($copy) { try { $null = $copy.Wait(5000) } catch { } }
        }
        if ($stdoutFile) { $stdoutFile.Dispose() }
        if ($stderrFile) { $stderrFile.Dispose() }
        $process.Dispose()
    }
}

function Write-Plan2Handoff {
    param($Context, $TaskState, $Attempt, [string]$Reason)
    $dirty = Invoke-RepositoryGit $Context.root @('status', '--short')
    $head = Invoke-RepositoryGit $Context.root @('rev-parse', 'HEAD')
    Write-AtomicText (Join-Path $Attempt.directory 'scheduler-handoff.md') @"
# $($TaskState.id) / $($Attempt.id)
UTC: $(Get-UtcStamp)
Status: $($TaskState.status)
Reason: $Reason
Task base: $($TaskState.baseCommit)
Current HEAD: $head
Worker PID: $($Attempt.processId)
Worker started UTC: $($Attempt.processStartedAt)
Exit code: $($Attempt.exitCode)
Thread ID: $($Attempt.threadId)
Inspect prompt.md, implement.SKILL.md, events.jsonl, stderr.log and result.json in this directory.
Repository changes at checkpoint:
$dirty
Resume uses a new session and reads this record; inspect partial edits/commits before retrying.
"@
}

function Assert-CompletedPlan2Tasks {
    param($Context, $State, [switch]$AllowPartialWorktree)
    foreach ($taskState in @($State.tasks | Where-Object status -eq 'completed')) {
        $definition = $Context.tasks | Where-Object id -eq $taskState.id
        $checked = Assert-Plan2Result $Context $taskState $definition $taskState.attempts[-1] -AllowHuman -AllowPartialWorktree:$AllowPartialWorktree
        if ($checked.needsHuman) {
            if (!$taskState.humanRecord) { throw "Missing human acceptance: $($taskState.id)" }
            Assert-Plan2HumanRecord $Context $taskState $checked.result (Read-Json $taskState.humanRecord)
        }
        $null = Invoke-RepositoryGit $Context.root @('merge-base', '--is-ancestor', $taskState.completedCommit, 'HEAD')
    }
}

function Assert-Plan2HumanRecord {
    param($Context, $TaskState, $Result, $Record)
    if ($Record.approved -isnot [bool] -or !$Record.approved -or !$Record.reviewer -or !$Record.acceptedAt -or $Record.taskId -ne $TaskState.id -or $Record.attemptId -ne $TaskState.attempts[-1].id -or $Record.commit -ne $Result.commit -or $Record.planHash -ne $Context.planHash -or !@($Record.evidence).Count) { throw 'Human acceptance record is incomplete or for another task/attempt/commit/plan.' }
    $null = [DateTimeOffset]::Parse($Record.acceptedAt)
    foreach ($entry in $Record.evidence) {
        $absolute = Resolve-Plan2Evidence $Context $entry.path
        if ((Get-Sha256 $absolute) -ne $entry.sha256) { throw "Human evidence hash mismatch: $($entry.path)" }
        $blob = Invoke-RepositoryGit $Context.root @('hash-object', '--', $absolute)
        if ($blob -ne (Invoke-RepositoryGit $Context.root @('rev-parse', "HEAD:$($entry.path.Replace('\', '/'))"))) { throw 'Human evidence must be committed before acceptance.' }
    }
}

function Invoke-Plan2Schedule {
    param($Context, $State, [string]$CodexPath, [switch]$Resume, [int]$MaxTasks, [int]$TimeoutMinutes)
    Assert-Plan2State $Context $State
    foreach ($taskState in @($State.tasks | Where-Object { $_.attempts.Count -gt 0 -and $_.status -ne 'completed' })) {
        $attempt = $taskState.attempts[-1]
        if ($attempt.launchPending) { throw "Unknown launch identity for $($taskState.id). Use RecoverLaunch after inspecting/ending orphan workers; automatic retry is unsafe." }
        if (Test-Plan2ChildAlive $attempt) { throw "Worker is still alive for $($taskState.id). Use Stop, then Run -Resume." }
    }
    $running = @($State.tasks | Where-Object status -eq 'running')
    foreach ($taskState in $running) {
        $attempt = $taskState.attempts[-1]
        if (Test-Plan2ChildAlive $attempt) { throw "Worker is still alive for $($taskState.id). Use Stop, then Run -Resume." }
        $taskState.status = 'paused'; $State.pausedTask = $taskState.id; $State.reason = 'Interrupted scheduler; inspect partial task work.'
        Write-Plan2Handoff $Context $taskState $attempt $State.reason
        Save-Plan2State $Context $State
    }
    if ($State.pausedTask -and !$Resume) { throw "Paused at $($State.pausedTask): $($State.reason). Inspect records, then explicitly Run -Resume." }
    if ($State.pausedTask -and ($State.tasks | Where-Object id -eq $State.pausedTask).status -eq 'needs_human') { throw 'Human acceptance pending. Use AcceptHuman with a concrete record before Run.' }
    # Partial changes from this one interrupted task are allowed only during explicit resume.
    if (!$State.pausedTask) { Assert-Plan2Clean $Context }
    Assert-CompletedPlan2Tasks $Context $State -AllowPartialWorktree:([bool]$State.pausedTask)
    if (!(Test-Path -LiteralPath $Context.skillPath -PathType Leaf)) { throw "Local implement skill missing: $($Context.skillPath)" }
    $stopPath = Join-Path $Context.stateRoot 'stop.request'
    if (Test-Path -LiteralPath $stopPath) {
        if (!$Resume) { throw 'Stop flag present; use Run -Resume explicitly.' }
        Remove-Item -LiteralPath $stopPath
    }
    $count = 0
    while ($MaxTasks -eq 0 -or $count -lt $MaxTasks) {
        if (Test-Path -LiteralPath $stopPath) { Add-Plan2Event $Context 'Stopped between tasks.'; return }
        Assert-Plan2State $Context $State
        $definition = if ($State.pausedTask) { $Context.tasks | Where-Object id -eq $State.pausedTask } else { Get-NextPlan2Task $Context.tasks $State }
        if (!$definition) { Add-Plan2Event $Context 'All 44 tasks completed with validated evidence.'; return }
        $taskState = $State.tasks | Where-Object id -eq $definition.id
        foreach ($dependency in $definition.dependencies) {
            if (($State.tasks | Where-Object id -eq $dependency).status -ne 'completed') { throw "Dependency incomplete: $dependency" }
        }
        if (!$State.pausedTask) { Assert-Plan2Clean $Context }
        Assert-CompletedPlan2Tasks $Context $State -AllowPartialWorktree:([bool]$State.pausedTask)
        $startCommit = Invoke-RepositoryGit $Context.root @('rev-parse', 'HEAD')
        if (!$taskState.baseCommit) { $taskState.baseCommit = $startCommit }
        $null = Invoke-RepositoryGit $Context.root @('merge-base', '--is-ancestor', $taskState.baseCommit, $startCommit)
        $attemptId = '{0}-{1}-{2}' -f $definition.id, [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), [guid]::NewGuid().ToString('N').Substring(0, 8)
        $attempt = [pscustomobject]@{
            id = $attemptId; directory = Join-Path $Context.stateRoot "attempts/$($definition.id)/$attemptId"
            startedAt = Get-UtcStamp; finishedAt = ''; startCommit = $startCommit
            skillHash = Get-Sha256 $Context.skillPath; launchPending = $false; processId = 0; processStartedAt = ''; exitCode = -1; threadId = ''; reason = ''
        }
        Write-AtomicText (Join-Path $attempt.directory 'implement.SKILL.md') (Get-Content -LiteralPath $Context.skillPath -Raw -Encoding UTF8)
        # Preserve exact bytes so the snapshot hash also works for UTF8 BOM or CRLF skills.
        [IO.File]::WriteAllBytes((Join-Path $attempt.directory 'implement.SKILL.md'), [IO.File]::ReadAllBytes($Context.skillPath))
        $taskState.attempts = @($taskState.attempts) + $attempt
        Write-AtomicText (Join-Path $attempt.directory 'prompt.md') (New-Plan2Prompt $Context $State $definition $taskState $attempt)
        $taskState.status = 'running'; $State.pausedTask = ''; $State.reason = ''
        Save-Plan2State $Context $State
        Add-Plan2Event $Context "Starting $($definition.id), new session, attempt $attemptId"
        try {
            Invoke-Plan2Worker $Context $State $attempt $CodexPath $TimeoutMinutes
            $checked = Assert-Plan2Result $Context $taskState $definition $attempt
            $attempt.threadId = $checked.threadId
            if ($checked.needsHuman) {
                $taskState.status = 'needs_human'; $State.pausedTask = $definition.id; $State.reason = 'Required human acceptance awaits a committed evidence record.'
            } else {
                $taskState.status = 'completed'; $taskState.completedCommit = $checked.result.commit
            }
        } catch {
            $taskState.status = 'paused'; $State.pausedTask = $definition.id; $State.reason = $_.Exception.Message
        } finally {
            if ($taskState.status -eq 'running') {
                $taskState.status = 'paused'; $State.pausedTask = $definition.id; $State.reason = 'Scheduler interrupted during task.'
            }
            $attempt.finishedAt = Get-UtcStamp; $attempt.reason = $State.reason
            Write-Plan2Handoff $Context $taskState $attempt $State.reason
            Save-Plan2State $Context $State
            Add-Plan2Event $Context "$($definition.id): $($taskState.status) $($State.reason)"
        }
        if ($State.pausedTask) { throw "Scheduler paused: $($State.pausedTask) $($State.reason)" }
        $count++
    }
}

Export-ModuleMember -Function *-Plan2*, Get-NextPlan2Task
