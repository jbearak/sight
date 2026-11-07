using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.ComponentModel;
using Microsoft.Win32.SafeHandles;
public sealed class ProofPty : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Coord { public short x,y; }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup { public int cb;public string reserved,desktop,title;public int x,y,xsize,ysize,xchars,ychars,fill,flags;public short show,reserved2;public IntPtr reserved3,stdin,stdout,stderr; }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup info; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread;public int pid,tid; }
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr r,out IntPtr w,IntPtr attrs,int size);
    [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(Coord size,IntPtr input,IntPtr output,int flags,out IntPtr pc);
    [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr pc);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr p,int count,int flags,ref IntPtr size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr p,uint flags,IntPtr attr,IntPtr value,IntPtr size,IntPtr prev,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr p);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo info);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int h);
    [DllImport("kernel32.dll")] static extern bool SetStdHandle(int h,IntPtr v);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h,uint code);
    IntPtr pc,attrs; ProcessInfo process;
    FileStream reader,writer; Task reading;
    readonly MemoryStream bytes=new MemoryStream();
    readonly StringBuilder text=new StringBuilder();
    static void Check(bool ok) { if(!ok)throw new Win32Exception(); }
    public int Pid { get { return process.pid; } }
    public bool HasExited { get { return WaitForSingleObject(process.process,0)==0; } }
    public int ExitCode { get { uint code;Check(GetExitCodeProcess(process.process,out code));return (int)code; } }
    public ProofPty(string command,string cwd) {
        IntPtr ir,iw,orr,ow;
        Check(CreatePipe(out ir,out iw,IntPtr.Zero,0));Check(CreatePipe(out orr,out ow,IntPtr.Zero,0));
        Marshal.ThrowExceptionForHR(CreatePseudoConsole(new Coord{x=100,y=30},ir,ow,0,out pc));
        CloseHandle(ir);CloseHandle(ow);
        IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
        attrs=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(attrs,1,0,ref size));
        Check(UpdateProcThreadAttribute(attrs,0,(IntPtr)0x20016,pc,(IntPtr)IntPtr.Size,IntPtr.Zero,IntPtr.Zero));
        var startup=new StartupEx();startup.info.cb=Marshal.SizeOf(typeof(StartupEx));startup.attributes=attrs;
        IntPtr sin=GetStdHandle(-10),sout=GetStdHandle(-11),serr=GetStdHandle(-12);
        try {SetStdHandle(-10,IntPtr.Zero);SetStdHandle(-11,IntPtr.Zero);SetStdHandle(-12,IntPtr.Zero);
            Check(CreateProcess(null,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x80000,IntPtr.Zero,cwd,ref startup,out process));
        } finally {SetStdHandle(-10,sin);SetStdHandle(-11,sout);SetStdHandle(-12,serr);}
        CloseHandle(process.thread);
        reader=new FileStream(new SafeFileHandle(orr,true),FileAccess.Read,4096,false);
        writer=new FileStream(new SafeFileHandle(iw,true),FileAccess.Write,4096,false);
        reading=Task.Run(()=>{try {byte[] buffer=new byte[4096];int n;while((n=reader.Read(buffer,0,buffer.Length))>0){lock(text){bytes.Write(buffer,0,n);text.Append(Encoding.UTF8.GetString(buffer,0,n));}}}catch(IOException){}});
    }
    public string Snapshot() {lock(text){return text.ToString();}}
    public void Send(string value) {var data=Encoding.UTF8.GetBytes(value);writer.Write(data,0,data.Length);writer.Flush();}
    public bool WaitExit(int ms) {return WaitForSingleObject(process.process,(uint)ms)==0;}
    public void Kill() {TerminateProcess(process.process,99);WaitExit(5000);}
    public void Save(string path) {lock(text){File.WriteAllBytes(path,bytes.ToArray());}}
    public void Dispose() {writer.Dispose();ClosePseudoConsole(pc);reading.Wait(5000);reader.Dispose();CloseHandle(process.process);DeleteProcThreadAttributeList(attrs);Marshal.FreeHGlobal(attrs);}
}
