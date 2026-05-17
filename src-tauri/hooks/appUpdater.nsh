!macro NSIS_HOOK_PREUNINSTALL
  ; Attempt to terminate the running application so uninstall can proceed
  ; Wait for taskkill to finish; ignore non-zero exit codes
  ExecWait '"$SYSDIR\\taskkill.exe" /IM "GameLibrary.exe" /F' $0
  ; small pause to let the OS clean up handles
  Sleep 500
!macroend
