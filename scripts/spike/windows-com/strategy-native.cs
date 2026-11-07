using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class StrategyNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct ServerInformation {
        public uint dwServerPid;
        public uint dwServerTid;
        public ulong ui64ServerAddress;
    }
    [DllImport("combase.dll", PreserveSig=true)]
    static extern int CoDecodeProxy(uint clientPid, ulong proxy,
        out ServerInformation information);
    [DllImport("ole32.dll", PreserveSig=true)]
    static extern int CoGetClassObject(ref Guid clsid, uint context,
        IntPtr reserved, ref Guid iid, out IntPtr factory);
    public static int GetFactory(string clsid, uint context, out IntPtr p) {
        Guid c = new Guid(clsid);
        Guid iid = new Guid("00000001-0000-0000-C000-000000000046");
        return CoGetClassObject(ref c, context, IntPtr.Zero, ref iid, out p);
    }
    public static int Decode(IntPtr factory, out ServerInformation information) {
        return CoDecodeProxy((uint)Process.GetCurrentProcess().Id,
            unchecked((ulong)factory.ToInt64()), out information);
    }
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int CreateInstanceDelegate(IntPtr factory, IntPtr outer,
        ref Guid iid, out IntPtr result);
    public static object CreateExact(IntPtr factory) {
        IntPtr vtable = Marshal.ReadIntPtr(factory);
        IntPtr entry = Marshal.ReadIntPtr(vtable, 3 * IntPtr.Size);
        var create = (CreateInstanceDelegate)Marshal.GetDelegateForFunctionPointer(
            entry, typeof(CreateInstanceDelegate));
        Guid dispatch = new Guid("00020400-0000-0000-C000-000000000046");
        IntPtr p;
        int hr = create(factory, IntPtr.Zero, ref dispatch, out p);
        Marshal.ThrowExceptionForHR(hr);
        if (p == IntPtr.Zero) throw new Exception("Null IDispatch");
        try { return Marshal.GetObjectForIUnknown(p); }
        finally { Marshal.Release(p); }
    }
}
