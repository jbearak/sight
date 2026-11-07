Imports System
Imports System.IO
Imports System.Threading
Imports System.Runtime.InteropServices

Module FactoryClient
    <STAThread()>
    Sub Main(args As String())
        Dim directory = args(0)
        Dim token = args(1)
        ' Exact documented early-bound construction, using the installed typelib.
        Dim stataobj As New stata.StataOLEApp()
        Dim before = stataobj.MacroValue("SIGHT_FACTORY_MARK")
        Dim rc = stataobj.DoCommand("global SIGHT_FACTORY_MARK " & token)
        If rc <> 0 Then Throw New Exception("global rc=" & rc)
        rc = stataobj.DoCommand("window manage maintitle """ & token & """")
        If rc <> 0 Then Throw New Exception("title rc=" & rc)
        File.WriteAllLines(Path.Combine(directory, "client.ready"),
            New String() {before, stataobj.MacroValue("SIGHT_FACTORY_MARK"),
                RuntimeInformation.ProcessArchitecture.ToString(),
                Environment.Version.ToString()})
        While Not File.Exists(Path.Combine(directory, "client.release"))
            Thread.Sleep(50)
        End While
        Marshal.FinalReleaseComObject(stataobj)
        stataobj = Nothing
        File.WriteAllText(Path.Combine(directory, "client.released"), "released")
    End Sub
End Module
