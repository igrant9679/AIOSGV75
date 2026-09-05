' Hidden launcher for watchdog.ps1 - what the "Mission Control Watchdog"
' Scheduled Task actually runs. wscript + window style 0 means the 5-minute
' check never flashes a console window in your session (same trick as the
' Startup launcher). Resolves its own folder, so nothing here names a machine.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\watchdog.ps1""", 0, False
