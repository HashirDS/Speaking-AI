param(
  [int]$DebugPort = 9334,
  [string]$ScreenshotPath = ""
)

$ErrorActionPreference = "Stop"
$targets = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json"
$target = $targets | Where-Object { $_.type -eq "page" -and $_.url -like "http://127.0.0.1:*" } | Select-Object -First 1
if (-not $target) { throw "No Luma page target found" }

$socket = [System.Net.WebSockets.ClientWebSocket]::new()
[void]$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
$script:messageId = 0

function Invoke-Cdp {
  param([string]$Method, [hashtable]$Params = @{})
  $script:messageId += 1
  $id = $script:messageId
  $payload = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 20 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  [void]$socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  while ($true) {
    $buffer = New-Object byte[] 1048576
    $segment = [ArraySegment[byte]]::new($buffer)
    $builder = [Text.StringBuilder]::new()
    do {
      $received = $socket.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      [void]$builder.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $received.Count))
    } until ($received.EndOfMessage)
    $message = $builder.ToString() | ConvertFrom-Json
    if ($message.id -eq $id) {
      if ($message.error) { throw "CDP $Method failed: $($message.error.message)" }
      return $message.result
    }
  }
}

function Invoke-Js {
  param([string]$Expression)
  $result = Invoke-Cdp "Runtime.evaluate" @{ expression = $Expression; awaitPromise = $true; returnByValue = $true }
  if ($result.exceptionDetails) { throw $result.exceptionDetails.text }
  return $result.result.value
}

function Wait-ForJs {
  param([string]$Expression, [int]$TimeoutMs = 6000)
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  do {
    if (Invoke-Js $Expression) { return $true }
    Start-Sleep -Milliseconds 120
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for: $Expression"
}

try {
  Invoke-Cdp "Runtime.enable" | Out-Null
  $needsReset = -not (Invoke-Js "Boolean(document.querySelector('#onboarding-form'))")
  if ($needsReset) {
    Invoke-Js "new Promise(resolve=>{localStorage.clear();const r=indexedDB.deleteDatabase('ielts-speaking-coach');r.onsuccess=r.onerror=r.onblocked=()=>resolve(true)}).then(()=>location.reload())" | Out-Null
  }
  Wait-ForJs "Boolean(document.querySelector('#onboarding-form'))" | Out-Null
  Invoke-Js "document.querySelector('#learner-name').value='Test Learner'; document.querySelector('#target-band').value='8'; document.querySelector('#daily-minutes').value='20'; document.querySelector('#onboarding-form').requestSubmit(); true" | Out-Null
  Wait-ForJs "Boolean(document.querySelector('.hero-card'))" | Out-Null
  $dashboardHeading = Invoke-Js "document.querySelector('.page-heading h1')?.textContent"
  $topicCount = Invoke-Js "indexedDB.databases().then(items => items.some(item => item.name === 'ielts-speaking-coach'))"
  Invoke-Js "document.querySelector('[data-start-session=part1]').click(); true" | Out-Null
  Wait-ForJs "Boolean(document.querySelector('.question-card'))" | Out-Null
  $question = Invoke-Js "document.querySelector('.question-card h1').textContent"
  Invoke-Js "document.querySelector('#answer-text').value='I currently live in Lahore, which is a lively and diverse city. I enjoy my neighbourhood because it is convenient, although the traffic can sometimes be challenging. For example, there is a quiet park nearby where I walk in the evening, so the area gives me a useful balance between activity and relaxation.'; document.querySelector('[data-action=submit-typed]').click(); true" | Out-Null
  Wait-ForJs "Boolean(document.querySelector('.answer-feedback'))" | Out-Null
  $feedback = Invoke-Js "document.querySelector('.feedback-block.priority p').textContent"
  $pronunciation = Invoke-Js "Array.from(document.querySelectorAll('.mini-score')).at(-1).querySelector('strong').textContent"
  $attemptCount = Invoke-Js "new Promise((resolve,reject)=>{const r=indexedDB.open('ielts-speaking-coach');r.onsuccess=()=>{const q=r.result.transaction('attempts').objectStore('attempts').count();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)}})"

  if ($ScreenshotPath) {
    $capture = Invoke-Cdp "Page.captureScreenshot" @{ format = "png"; captureBeyondViewport = $false }
    [IO.File]::WriteAllBytes($ScreenshotPath, [Convert]::FromBase64String($capture.data))
  }

  Invoke-Js "location.reload(); true" | Out-Null
  Wait-ForJs "Boolean(document.querySelector('.hero-card'))" | Out-Null
  Invoke-Js "document.querySelector('[data-start-session=part2]').click(); true" | Out-Null
  Wait-ForJs "Boolean(document.querySelector('[data-action=start-prep]'))" | Out-Null
  $cueBullets = Invoke-Js "document.querySelectorAll('.cue-bullets li').length"
  Invoke-Js "document.querySelector('[data-action=start-prep]').click(); true" | Out-Null
  Wait-ForJs "Boolean(document.querySelector('#prep-count'))" | Out-Null
  Start-Sleep -Milliseconds 1100
  $prepRemaining = Invoke-Js "Number(document.querySelector('#prep-count').textContent)"
  $canSkipPrep = Invoke-Js "Boolean(document.querySelector('[data-action=begin-answer]'))"
  Invoke-Js "location.reload(); true" | Out-Null
  Wait-ForJs "Boolean(document.querySelector('.hero-card'))" | Out-Null
  Invoke-Js "document.querySelector('[data-start-session=mock]').click(); true" | Out-Null
  Wait-ForJs "Boolean(document.querySelector('.question-card'))" | Out-Null
  $mockProgress = Invoke-Js "Array.from(document.querySelectorAll('.session-chip')).find(item => item.textContent.includes('/'))?.textContent"
  $mockHasSkip = Invoke-Js "Boolean(document.querySelector('[data-action=skip-question]'))"
  Invoke-Js "new Promise((resolve,reject)=>{const r=indexedDB.open('ielts-speaking-coach');r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['attempts','sessions'],'readwrite');tx.objectStore('attempts').put({id:'legacy-attempt',sessionId:'legacy-session',createdAt:new Date().toISOString(),mode:'part1',requestedMode:'part1',topicId:'p1-home',question:'What kind of place do you live in?',part:1,inputMode:'speech',text:'I live in a quiet area because it is convenient for my family.',criteria:{fluency:9,lexical:9,grammar:9,pronunciation:9},overall:9,reliability:'useful',metrics:{words:12,durationSeconds:12,wpm:60,fillers:0,confidence:60,pauseCount:0}});tx.objectStore('sessions').put({id:'legacy-session',createdAt:new Date().toISOString(),completedAt:new Date().toISOString(),mode:'part1',requestedMode:'part1',questionCount:1,attemptIds:['legacy-attempt'],summary:{criteria:{fluency:9,lexical:9,grammar:9,pronunciation:9},overall:9,reliability:'useful',totalWords:12,totalSeconds:12}});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})" | Out-Null
  Invoke-Js "location.reload(); true" | Out-Null
  Wait-ForJs "Boolean(document.querySelector('.hero-card'))" | Out-Null
  $legacyMigration = Invoke-Js "new Promise((resolve,reject)=>{const r=indexedDB.open('ielts-speaking-coach');r.onsuccess=()=>{const q=r.result.transaction('attempts').objectStore('attempts').get('legacy-attempt');q.onsuccess=()=>resolve({version:q.result.scoringVersion,pronunciation:q.result.criteria.pronunciation,overall:q.result.overall});q.onerror=()=>reject(q.error)}})"

  [PSCustomObject]@{
    Dashboard = $dashboardHeading
    DatabaseReady = $topicCount
    FirstQuestion = $question
    Feedback = $feedback
    TypedPronunciation = $pronunciation
    SavedAttempts = $attemptCount
    CueCardBullets = $cueBullets
    PrepTimerRunning = ($prepRemaining -le 59 -and $prepRemaining -gt 0)
    StrictPrepCanSkip = $canSkipPrep
    MockProgress = $mockProgress
    MockHasSkip = $mockHasSkip
    LegacyScoreVersion = $legacyMigration.version
    LegacyPronunciation = if ($null -eq $legacyMigration.pronunciation) { "unscored" } else { $legacyMigration.pronunciation }
    LegacyOverall = if ($null -eq $legacyMigration.overall) { "unscored" } else { $legacyMigration.overall }
  } | Format-List
} finally {
  if ($socket.State -eq [Net.WebSockets.WebSocketState]::Open) {
    [void]$socket.CloseAsync([Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  }
  $socket.Dispose()
}
