; Nevix installer additions (electron-builder NSIS include).
; - Registers Nevix as a *selectable* browser in Windows "Default apps" (Windows never lets an installer force the default).
; - Leaves a one-time marker so the first launch offers to import data from other browsers.
; No services, scheduled tasks, startup entries or background updaters are created.

!macro customInstall
  CreateDirectory "$APPDATA\Nevix"
  FileOpen $0 "$APPDATA\Nevix\first-run-import" w
  FileClose $0

  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix" "" "Nevix"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\Capabilities" "ApplicationName" "Nevix"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\Capabilities" "ApplicationDescription" "Private, fast, bloat-free web browser"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\Capabilities\URLAssociations" "http" "NevixURL"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\Capabilities\URLAssociations" "https" "NevixURL"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\Capabilities\FileAssociations" ".html" "NevixHTML"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\Capabilities\FileAssociations" ".htm" "NevixHTML"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\Capabilities\FileAssociations" ".xhtml" "NevixHTML"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\Capabilities\FileAssociations" ".pdf" "NevixHTML"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Nevix" "Software\Clients\StartMenuInternet\Nevix\Capabilities"

  WriteRegStr SHELL_CONTEXT "Software\Classes\NevixURL" "" "Nevix URL"
  WriteRegStr SHELL_CONTEXT "Software\Classes\NevixURL" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\NevixURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\NevixURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\NevixHTML" "" "Nevix HTML Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\NevixHTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\NevixHTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Clients\StartMenuInternet\Nevix"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Nevix"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\NevixURL"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\NevixHTML"
!macroend
