using System;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Forms;

[ComVisible(true), Guid("00000001-0000-0000-C000-000000000046")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IIdentityProbeFactory {
    [PreserveSig] int CreateInstance(IntPtr outer, ref Guid iid, out IntPtr value);
    [PreserveSig] int LockServer([MarshalAs(UnmanagedType.Bool)] bool value);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class IdentityProbeFactory : IIdentityProbeFactory {
    public int CreateInstance(IntPtr outer, ref Guid iid, out IntPtr value) {
        value=IntPtr.Zero; return unchecked((int)0x80004001);
    }
    public int LockServer(bool value) { return 0; }
}
class IdentityServer {
    [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr p, uint flags);
    [DllImport("ole32.dll")] static extern void CoUninitialize();
    [DllImport("ole32.dll")] static extern int CoRegisterClassObject(ref Guid clsid,
        [MarshalAs(UnmanagedType.IUnknown)] object factory, uint context, uint flags, out uint cookie);
    [DllImport("ole32.dll")] static extern int CoRevokeClassObject(uint cookie);
    [STAThread] static void Main(string[] args) {
        Marshal.ThrowExceptionForHR(CoInitializeEx(IntPtr.Zero,2));
        uint cookie=0;
        var factory=new IdentityProbeFactory();
        try {
            Guid clsid=new Guid(args[1]);
            Marshal.ThrowExceptionForHR(CoRegisterClassObject(ref clsid,factory,4,1,out cookie));
            File.WriteAllText(Path.Combine(args[0],"identity.ready"),"registered");
            var deadline=DateTime.UtcNow.AddSeconds(30);
            while (!File.Exists(Path.Combine(args[0],"identity.stop")) && DateTime.UtcNow<deadline) {
                Application.DoEvents(); Thread.Sleep(10);
            }
        } finally {
            if (cookie!=0) Marshal.ThrowExceptionForHR(CoRevokeClassObject(cookie));
            GC.KeepAlive(factory); CoUninitialize();
        }
    }
}
