package uz.nasiyadaftari.admin;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Nasiya obunalar: Nasiya daftari obunalarini boshqarish ilovasi (faqat egasi uchun).
 * Sahifa (assets/www) xavfsiz https manzilda ochiladi. Ma'lumotlar shu telefonda saqlanadi;
 * zaxira nusxa Download/Nasiya papkasiga yoziladi.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int REQ_STORAGE = 11;
    private static final int REQ_FILE = 20;
    private static final String AUTO_NAME = "Nasiya-obunalar-avtozaxira.json";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "NasiyaNative");
        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new ChromeClient());

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.__nasiyaBack ? window.__nasiyaBack() : false", value -> {
            if (!"true".equals(value)) finish();
        });
    }

    /* ---------------- sahifa fayllari (assets/www) ---------------- */

    private class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
            if (path.contains("..")) return notFound();
            try {
                InputStream in = getAssets().open("www" + path);
                WebResourceResponse r = new WebResourceResponse(mimeOf(path), "UTF-8", in);
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "no-cache");
                r.setResponseHeaders(h);
                return r;
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (HOST.equals(u.getHost())) return false;
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, u);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (ActivityNotFoundException e) {
                Toast.makeText(MainActivity.this, "Bu havolani ochadigan ilova topilmadi", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    /* ---------------- fayl tanlash (zaxiradan tiklash) ---------------- */

    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(i, "Zaxira faylni tanlang"), REQ_FILE);
                return true;
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    /* ---------------- zaxira faylini saqlash ---------------- */

    private boolean granted(String perm) {
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("nasiya-obunalar", MODE_PRIVATE);
    }

    private String saveToDownloads(String name, String content) throws IOException {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
            v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Nasiya");
            ContentResolver cr = getContentResolver();
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("insert");
            try (OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) throw new IOException("open");
                out.write(bytes);
            }
            return "Download/Nasiya/" + safe;
        }
        if (!granted(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            ui.post(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE));
            return null;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Nasiya");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir");
        try (FileOutputStream out = new FileOutputStream(new File(dir, safe))) {
            out.write(bytes);
        }
        return "Download/Nasiya/" + safe;
    }

    /**
     * Zaxirani Download/Nasiya/Nasiya-obunalar-avtozaxira.json ga yozadi (har safar ustidan).
     * Fayl umumiy "Download" papkasida, shuning uchun ilova o'chirilsa ham telefonda qoladi.
     */
    private synchronized Uri writeAutoBackup(String content) throws IOException {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = getContentResolver();
            String saved = prefs().getString("autoUri", null);
            if (saved != null) {
                Uri old = Uri.parse(saved);
                try (OutputStream out = cr.openOutputStream(old, "wt")) {
                    if (out != null) { out.write(bytes); return old; }
                } catch (Exception ignored) { }
            }
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, AUTO_NAME);
            v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Nasiya");
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("insert");
            try (OutputStream out = cr.openOutputStream(uri, "wt")) {
                if (out == null) throw new IOException("open");
                out.write(bytes);
            }
            prefs().edit().putString("autoUri", uri.toString()).apply();
            return uri;
        }
        if (!granted(Manifest.permission.WRITE_EXTERNAL_STORAGE)) return null;
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Nasiya");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir");
        File f = new File(dir, AUTO_NAME);
        try (FileOutputStream out = new FileOutputStream(f, false)) {
            out.write(bytes);
        }
        return Uri.fromFile(f);
    }

    private String displayName(Uri uri) {
        if (!"content".equals(uri.getScheme())) return uri.getLastPathSegment();
        try (Cursor c = getContentResolver().query(uri, new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return AUTO_NAME;
    }

    /* ---------------- JavaScript ko'prigi ---------------- */

    private class Bridge {
        /** Har o'zgarishdan keyin chaqiriladi. Qaytaradi: "Download/Nasiya/<fayl>" yoki null. */
        @JavascriptInterface
        public String autoBackup(String content) {
            try {
                Uri uri = writeAutoBackup(content);
                return uri == null ? null : "Download/Nasiya/" + displayName(uri);
            } catch (Exception e) {
                return null;
            }
        }

        /** Zaxira faylini Telegram yoki boshqa ilovaga yuborish oynasini ochadi (Android 10+). */
        @JavascriptInterface
        public boolean shareBackup(String content) {
            if (Build.VERSION.SDK_INT < 29) return false;
            try {
                final Uri uri = writeAutoBackup(content);
                if (uri == null) return false;
                ui.post(() -> {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("application/json");
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.putExtra(Intent.EXTRA_TEXT, "Nasiya obunalar zaxirasi");
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        startActivity(Intent.createChooser(send, "Zaxirani yuborish"));
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "Yuborish uchun ilova topilmadi", Toast.LENGTH_SHORT).show();
                    }
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String saveFile(String name, String content) {
            try {
                return saveToDownloads(name, content);
            } catch (IOException e) {
                return null;
            }
        }
    }
}
