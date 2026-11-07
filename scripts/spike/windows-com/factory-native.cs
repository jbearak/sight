using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class FactoryNative {
    // Raw pointer only: no RCW, IDispatch, CreateInstance or LockServer.
    [DllImport("ole32.dll", PreserveSig=true)]
    public static extern int CoGetClassObject(ref Guid clsid, uint context,
        IntPtr reserved, ref Guid iid, out IntPtr factory);
    public static IntPtr Acquire(string clsid) {
        Guid c = new Guid(clsid);
        Guid iid = new Guid("00000001-0000-0000-C000-000000000046");
        IntPtr p;
        int hr = CoGetClassObject(ref c, 4, IntPtr.Zero, ref iid, out p);
        Marshal.ThrowExceptionForHR(hr);
        if (p == IntPtr.Zero) throw new Exception("Null factory");
        return p;
    }
    public static int Release(IntPtr p) { return Marshal.Release(p); }
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(
        uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool IsWow64Process2(
        IntPtr process, out ushort machine, out ushort native);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static string ProcessMachine(int pid) {
        IntPtr handle = OpenProcess(0x1000, false, pid);
        if (handle == IntPtr.Zero) throw new Exception("OpenProcess failed");
        try {
            ushort machine, native;
            if (!IsWow64Process2(handle, out machine, out native))
                throw new Exception("IsWow64Process2 failed");
            return String.Format("process=0x{0:X4};native=0x{1:X4}", machine, native);
        } finally { CloseHandle(handle); }
    }
    public delegate bool EnumProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(
        IntPtr parent, EnumProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern bool PostMessage(
        IntPtr h, uint m, IntPtr w, IntPtr l);
    public static string Class(IntPtr h) {
        var s = new StringBuilder(256); GetClassName(h,s,s.Capacity); return s.ToString();
    }
    public static string Text(IntPtr h) {
        var s = new StringBuilder(256); GetWindowText(h,s,s.Capacity); return s.ToString();
    }
    public static IntPtr[] Children(IntPtr h) {
        var list = new List<IntPtr>();
        EnumChildWindows(h, (w,d) => { list.Add(w); return true; }, IntPtr.Zero);
        return list.ToArray();
    }
}
