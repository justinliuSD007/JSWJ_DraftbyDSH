using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

internal static class IconPatcher
{
    private const uint RT_ICON = 3;
    private const uint RT_GROUP_ICON = 14;

    private delegate bool EnumResNameProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, IntPtr lParam);
    private delegate bool EnumResLangProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, ushort wIDLanguage, IntPtr lParam);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateResource(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResource(IntPtr hUpdate, bool discard);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EnumResourceNames(IntPtr hModule, IntPtr lpszType, EnumResNameProc lpEnumFunc, IntPtr lParam);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EnumResourceLanguages(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, EnumResLangProc lpEnumFunc, IntPtr lParam);

    private static ushort U16(byte[] data, int offset)
    {
        return (ushort)(data[offset] | (data[offset + 1] << 8));
    }

    private static uint U32(byte[] data, int offset)
    {
        return (uint)(data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24));
    }

    private static List<Tuple<IntPtr, ushort>> Collect(IntPtr h, uint type)
    {
        var result = new List<Tuple<IntPtr, ushort>>();
        EnumResourceNames(h, (IntPtr)type, delegate(IntPtr m, IntPtr t, IntPtr name, IntPtr p)
        {
            EnumResourceLanguages(h, (IntPtr)type, name, delegate(IntPtr m2, IntPtr t2, IntPtr name2, ushort lang, IntPtr p2)
            {
                result.Add(Tuple.Create(name2, lang));
                return true;
            }, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            Console.Error.WriteLine("usage: IconPatcher.exe <target.exe> <icon.ico>");
            return 2;
        }
        string target = Path.GetFullPath(args[0]);
        byte[] ico = File.ReadAllBytes(args[1]);
        if (ico.Length < 6 || U16(ico, 2) != 1) throw new InvalidDataException("not an ICO file");
        int count = U16(ico, 4);
        if (count <= 0 || count > 64) throw new InvalidDataException("invalid icon count");

        var images = new byte[count][];
        var metas = new byte[count][];
        var planes = new ushort[count];
        var bitCounts = new ushort[count];
        var ids = new ushort[count];
        int pos = 6;
        for (int i = 0; i < count; i++)
        {
            if (pos + 16 > ico.Length) throw new InvalidDataException("truncated ICO directory");
            byte width = ico[pos];
            byte height = ico[pos + 1];
            byte colors = ico[pos + 2];
            byte reserved = ico[pos + 3];
            ushort planesValue = U16(ico, pos + 4);
            ushort bitCountValue = U16(ico, pos + 6);
            uint size = U32(ico, pos + 8);
            uint offset = U32(ico, pos + 12);
            if (offset + size > ico.Length) throw new InvalidDataException("truncated ICO image");
            images[i] = new byte[size];
            Buffer.BlockCopy(ico, (int)offset, images[i], 0, (int)size);
            metas[i] = new byte[] { width, height, colors, reserved };
            planes[i] = planesValue;
            bitCounts[i] = bitCountValue;
            ids[i] = (ushort)(1 + i);
            pos += 16;
        }

        IntPtr h = BeginUpdateResource(target, false);
        if (h == IntPtr.Zero) throw new Exception("BeginUpdateResource failed: " + Marshal.GetLastWin32Error());

        try
        {
            foreach (var entry in Collect(h, RT_GROUP_ICON))
            {
                if (!UpdateResource(h, (IntPtr)RT_GROUP_ICON, entry.Item1, entry.Item2, null, 0))
                    throw new Exception("delete old group icon failed: " + Marshal.GetLastWin32Error());
            }
            foreach (var entry in Collect(h, RT_ICON))
            {
                if (!UpdateResource(h, (IntPtr)RT_ICON, entry.Item1, entry.Item2, null, 0))
                    throw new Exception("delete old icon failed: " + Marshal.GetLastWin32Error());
            }

            for (int i = 0; i < count; i++)
            {
                if (!UpdateResource(h, (IntPtr)RT_ICON, (IntPtr)ids[i], 0, images[i], (uint)images[i].Length))
                    throw new Exception("UpdateResource RT_ICON failed: " + Marshal.GetLastWin32Error());
            }

            byte[] group = new byte[6 + count * 14];
            group[0] = 0; group[1] = 0;
            group[2] = 1; group[3] = 0;
            group[4] = (byte)(count & 0xFF); group[5] = (byte)(count >> 8);
            int g = 6;
            for (int i = 0; i < count; i++)
            {
                group[g++] = metas[i][0];
                group[g++] = metas[i][1];
                group[g++] = metas[i][2];
                group[g++] = metas[i][3];
                byte[] planesBytes = BitConverter.GetBytes(planes[i]);
                group[g++] = planesBytes[0]; group[g++] = planesBytes[1];
                byte[] bitBytes = BitConverter.GetBytes(bitCounts[i]);
                group[g++] = bitBytes[0]; group[g++] = bitBytes[1];
                byte[] size = BitConverter.GetBytes((uint)images[i].Length);
                group[g++] = size[0]; group[g++] = size[1]; group[g++] = size[2]; group[g++] = size[3];
                byte[] id = BitConverter.GetBytes(ids[i]);
                group[g++] = id[0]; group[g++] = id[1];
            }
            if (!UpdateResource(h, (IntPtr)RT_GROUP_ICON, (IntPtr)1, 0, group, (uint)group.Length))
                throw new Exception("UpdateResource RT_GROUP_ICON failed: " + Marshal.GetLastWin32Error());
        }
        finally
        {
            EndUpdateResource(h, false);
        }
        Console.WriteLine("patched " + target);
        return 0;
    }
}
