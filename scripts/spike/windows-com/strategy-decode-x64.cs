using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
class DecodeX64 {
    [STAThread] static int Main(string[] args) {
        IntPtr p;
        int hr = StrategyNative.GetFactory(args[0], 0x8004, out p);
        Console.WriteLine("architecture="+RuntimeInformation.ProcessArchitecture+
            ";pid="+Process.GetCurrentProcess().Id+";session="+
            Process.GetCurrentProcess().SessionId+";acquire=0x"+hr.ToString("X8"));
        if (hr < 0) return 2;
        try {
            StrategyNative.ServerInformation info;
            hr = StrategyNative.Decode(p, out info);
            Console.WriteLine("decode=0x"+hr.ToString("X8")+";server_pid="+info.dwServerPid);
            return hr == 0 ? 0 : 3;
        } finally { Marshal.Release(p); }
    }
}
