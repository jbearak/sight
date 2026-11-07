using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

// Import the installed, registered Stata type library, without activating Stata.
public class FactoryInterop : ITypeLibImporterNotifySink {
    [DllImport("oleaut32.dll", PreserveSig=false)]
    static extern void LoadRegTypeLib(ref Guid libid, short major, short minor,
        int locale, out ITypeLib library);
    public void ReportEvent(ImporterEventKind kind, int code, string message) {
        Console.WriteLine("typelib: " + message);
    }
    public Assembly ResolveRef(object library) {
        throw new NotSupportedException("Unexpected external type library");
    }
    public static void Build(string output) {
        Guid id = new Guid("76656110-CB0F-44B4-90D2-D584B6768509");
        ITypeLib library;
        LoadRegTypeLib(ref id, 1, 1, 0, out library);
        try {
            var assembly = new TypeLibConverter().ConvertTypeLibToAssembly(
                library, output, TypeLibImporterFlags.None,
                new FactoryInterop(), null, null, "stata", null);
            assembly.Save(Path.GetFileName(output));
        } finally { Marshal.FinalReleaseComObject(library); }
    }
}
