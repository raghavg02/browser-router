using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public class ShellThumbnail
{
    [ComImport]
    [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig]
        int GetImage([In, MarshalAs(UnmanagedType.Struct)] SIZE size, [In] int flags, [Out] out IntPtr phbm);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE
    {
        public int cx;
        public int cy;
        public SIZE(int cx, int cy) { this.cx = cx; this.cy = cy; }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(
        [In, MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        [In] IntPtr pbc,
        [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [Out, MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    // SIIGBF_RESIZETOFIT = 0, SIIGBF_BIGGERSIZEOK = 0x1, SIIGBF_THUMBNAILONLY = 0x2
    private const int SIIGBF_THUMBNAILONLY = 0x2;

    public static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: ShellThumbnail <input_file> <output_image> [size]");
            return 1;
        }

        string inputFile = args[0];
        string outputFile = args[1];
        int size = 320;
        if (args.Length >= 3)
        {
            int.TryParse(args[2], out size);
            if (size <= 0) size = 320;
        }

        if (!File.Exists(inputFile))
        {
            Console.Error.WriteLine("Input file not found: " + inputFile);
            return 2;
        }

        IntPtr hBitmap = IntPtr.Zero;
        try
        {
            Guid guid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
            IShellItemImageFactory factory;
            SHCreateItemFromParsingName(inputFile, IntPtr.Zero, guid, out factory);
            if (factory == null)
            {
                Console.Error.WriteLine("Failed to create IShellItemImageFactory");
                return 3;
            }

            // First try with SIIGBF_THUMBNAILONLY (0x2)
            int hr = factory.GetImage(new SIZE(size, size), SIIGBF_THUMBNAILONLY, out hBitmap);
            if (hr != 0 || hBitmap == IntPtr.Zero)
            {
                // Fallback to flags = 0
                hr = factory.GetImage(new SIZE(size, size), 0, out hBitmap);
            }

            if (hr != 0 || hBitmap == IntPtr.Zero)
            {
                Console.Error.WriteLine("GetImage failed with HRESULT: 0x" + hr.ToString("X8"));
                return 4;
            }

            using (Bitmap bmp = Image.FromHbitmap(hBitmap))
            {
                string dir = Path.GetDirectoryName(outputFile);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                // Save with 90 quality JPEG
                ImageCodecInfo jpgEncoder = null;
                foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders())
                {
                    if (codec.FormatID == ImageFormat.Jpeg.Guid)
                    {
                        jpgEncoder = codec;
                        break;
                    }
                }

                if (jpgEncoder != null)
                {
                    EncoderParameters encParams = new EncoderParameters(1);
                    encParams.Param[0] = new EncoderParameter(Encoder.Quality, 90L);
                    bmp.Save(outputFile, jpgEncoder, encParams);
                }
                else
                {
                    bmp.Save(outputFile, ImageFormat.Jpeg);
                }
            }

            Console.WriteLine("OK: " + outputFile);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Exception: " + ex.Message);
            return 5;
        }
        finally
        {
            if (hBitmap != IntPtr.Zero)
            {
                DeleteObject(hBitmap);
            }
        }
    }
}
