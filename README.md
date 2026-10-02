# Nevix Windows builds (x64)

Files are split into <100 MB parts because of GitHub's file limit. Rejoin in `cmd`:

    copy /b Nevix-Setup.exe.00.part+Nevix-Setup.exe.01.part+Nevix-Setup.exe.02.part Nevix-Setup.exe
    copy /b Nevix-Portable.exe.00.part+Nevix-Portable.exe.01.part+Nevix-Portable.exe.02.part Nevix-Portable.exe

Verify against `SHA256SUMS.txt` (`certutil -hashfile Nevix-Setup.exe SHA256`). Built with electron-builder under wine; not code-signed, so Windows SmartScreen will warn. Not run on real Windows by the author.
