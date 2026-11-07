Option Explicit
Dim directory, token, fs, stataobj, before, rc, stream
directory = WScript.Arguments(0)
token = WScript.Arguments(1)
Set fs = CreateObject("Scripting.FileSystemObject")
' Exact documented VBScript construction.
Set stataobj = CreateObject("stata.StataOLEApp")
before = stataobj.MacroValue("SIGHT_FACTORY_MARK")
rc = stataobj.DoCommand("global SIGHT_FACTORY_MARK " & token)
If rc <> 0 Then WScript.Quit 2
rc = stataobj.DoCommand("window manage maintitle """ & token & """")
If rc <> 0 Then WScript.Quit 3
Set stream = fs.CreateTextFile(directory & "\client.ready", True)
stream.WriteLine before
stream.WriteLine stataobj.MacroValue("SIGHT_FACTORY_MARK")
stream.WriteLine fs.GetFileVersion(WScript.FullName)
stream.Close
Do Until fs.FileExists(directory & "\client.release")
    WScript.Sleep 50
Loop
Set stataobj = Nothing
Set stream = fs.CreateTextFile(directory & "\client.released", True)
stream.WriteLine "released"
stream.Close
