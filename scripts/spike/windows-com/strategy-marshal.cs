using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

// Public OBJREF metadata only. No IPID-to-PID tricks, no private memory reads.
public static class StrategyMarshal {
    [DllImport("ole32.dll", PreserveSig=false)]
    static extern void CreateStreamOnHGlobal(IntPtr memory, bool free, out IStream stream);
    [DllImport("ole32.dll", PreserveSig=true)]
    static extern int CoMarshalInterface(IStream stream, ref Guid iid,
        IntPtr factory, uint context, IntPtr reserved, uint flags);
    [DllImport("ole32.dll", PreserveSig=true)]
    static extern int CoReleaseMarshalData(IStream stream);
    public static string Inspect(IntPtr factory, uint context) {
        IStream stream;
        CreateStreamOnHGlobal(IntPtr.Zero, true, out stream);
        Guid iid = new Guid("00000001-0000-0000-C000-000000000046");
        int hr = CoMarshalInterface(stream, ref iid, factory, context, IntPtr.Zero, 0);
        try {
            if (hr < 0) return "marshal_hr=0x"+hr.ToString("X8");
            System.Runtime.InteropServices.ComTypes.STATSTG stat;
            stream.Stat(out stat, 1);
            if (stat.cbSize < 24 || stat.cbSize > 65536) throw new Exception("Unexpected OBJREF length");
            byte[] bytes = new byte[(int)stat.cbSize];
            stream.Seek(0,0,IntPtr.Zero);
            stream.Read(bytes,bytes.Length,IntPtr.Zero);
            if (BitConverter.ToUInt32(bytes,0) != 0x574F454D) throw new Exception("Invalid OBJREF signature");
            uint flags = BitConverter.ToUInt32(bytes,4);
            if (flags != 1) return "objref_flags="+flags+";nonstandard_objref=true;pid_not_inferred=true";
            if (bytes.Length < 68) throw new Exception("Truncated OBJREF_STANDARD");
            // MS-DCOM OBJREF header and STDOBJREF documented wire offsets.
            return "marshal_hr=0x00000000;size="+bytes.Length+
                ";signature=0x"+BitConverter.ToUInt32(bytes,0).ToString("X8")+
                ";objref_flags="+BitConverter.ToUInt32(bytes,4)+
                ";oxid=0x"+BitConverter.ToUInt64(bytes,32).ToString("X16")+
                ";resolver_array_entries="+BitConverter.ToUInt16(bytes,64)+
                ";pid_not_present=true;exporter_endpoint_not_resolved=true";
        } finally {
            if (hr >= 0) {
                stream.Seek(0,0,IntPtr.Zero);
                Marshal.ThrowExceptionForHR(CoReleaseMarshalData(stream));
            }
            Marshal.FinalReleaseComObject(stream);
        }
    }
}
