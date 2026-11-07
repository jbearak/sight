using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public class ProofSuspended : IDisposable {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Startup { public int cb; public string reserved,desktop,title; public int x,y,xsize,ysize,xchars,ychars,fill,flags; public short show,reserved2; public IntPtr reserved3,stdin,stdout,stderr; }
    [StructLayout(LayoutKind.Sequential)] struct Info { public IntPtr process,thread; public int pid,tid; }
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]
    static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string cwd,ref Startup startup,out Info info);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    Info info;
    public int Pid { get { return info.pid; } }
    public ProofSuspended(string exe,string arguments) {
        var startup=new Startup(); startup.cb=Marshal.SizeOf(typeof(Startup));
        if (!CreateProcess(exe,new StringBuilder("\""+exe+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,false,4,IntPtr.Zero,null,ref startup,out info)) throw new Win32Exception();
    }
    public void Resume() { if (ResumeThread(info.thread)==0xffffffff) throw new Win32Exception(); }
    public void Dispose() { if(info.thread!=IntPtr.Zero){CloseHandle(info.thread);info.thread=IntPtr.Zero;} if(info.process!=IntPtr.Zero){CloseHandle(info.process);info.process=IntPtr.Zero;} }
}
