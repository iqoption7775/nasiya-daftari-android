package uz.nasiyadaftari.app;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
import android.telephony.SmsManager;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Nasiya daftari — Android ilovasi.
 * Veb-ilova (assets/www) xavfsiz https manzilda ochiladi, SMS esa telefonning
 * o'z SIM kartasidan SmsManager orqali yuboriladi (window.NasiyaNative ko'prigi).
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final String ACTION_SENT = "uz.nasiyadaftari.app.SMS_SENT";
    private static final int REQ_PERMS = 10;
    private static final int REQ_STORAGE = 11;
    private static final int REQ_FILE = 20;
    private static final long RESULT_TIMEOUT_MS = 90_000;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSmsJson;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final AtomicInteger requestCodes = new AtomicInteger(1);
    private BroadcastReceiver sentReceiver;

    /** Har bir SMS uchun: [qolgan qismlar, xato qismlar, oxirgi xato kodi]. */
    private final Map<String, int[]> partState = new HashMap<>();
    /** Har bir paket uchun natijasi kelmagan SMS'lar soni. */
    private final Map<String, Integer> outstanding = new HashMap<>();

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

        sentReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                onPartSent(intent, getResultCode());
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_SENT);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(sentReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(sentReceiver, filter);
        }

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
        try { unregisterReceiver(sentReceiver); } catch (Exception ignored) { }
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

    /* ---------------- ilova fayllari (assets/www) ---------------- */

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
            openExternal(u);
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
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private void openExternal(Uri u) {
        Intent i;
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        if (scheme.equals("sms") || scheme.equals("smsto")) i = new Intent(Intent.ACTION_SENDTO, u);
        else if (scheme.equals("tel")) i = new Intent(Intent.ACTION_DIAL, u);
        else i = new Intent(Intent.ACTION_VIEW, u);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Bu havolani ochadigan ilova topilmadi", Toast.LENGTH_SHORT).show();
        }
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

    /* ---------------- ruxsatlar ---------------- */

    private boolean granted(String perm) {
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    /** Ilova so'raydigan yagona ruxsat: SMS yuborish. SMS o'qish, kontaktlar yoki qo'ng'iroqlarga ruxsat so'ralmaydi. */
    private void requestSmsPermissions() {
        if (!granted(Manifest.permission.SEND_SMS)) {
            requestPermissions(new String[]{Manifest.permission.SEND_SMS}, REQ_PERMS);
        }
    }

    /** Slot raqami bo'yicha SIM obuna ID si. Telefon holatini o'qish ruxsatini talab qilmaydi. */
    private int subIdForSlot(int slot) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                int id = SubscriptionManager.getSubscriptionId(slot);
                return SubscriptionManager.isValidSubscriptionId(id) ? id : -1;
            }
            if (Build.VERSION.SDK_INT >= 29) {
                SubscriptionManager sm = getSystemService(SubscriptionManager.class);
                int[] ids = sm == null ? null : sm.getSubscriptionIds(slot);
                if (ids != null && ids.length > 0 && SubscriptionManager.isValidSubscriptionId(ids[0])) return ids[0];
            }
        } catch (Exception ignored) { }
        return -1;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_PERMS) {
            js("window.__nasiyaPermissions && window.__nasiyaPermissions()");
            String pending = pendingSmsJson;
            pendingSmsJson = null;
            if (pending != null) {
                if (granted(Manifest.permission.SEND_SMS)) startSending(pending);
                else failAll(pending, "SMS yuborishga ruxsat berilmadi");
            }
        }
    }

    /* ---------------- SMS yuborish ---------------- */

    private SmsManager smsManagerFor(int subId) {
        if (Build.VERSION.SDK_INT >= 31) {
            SmsManager base = getSystemService(SmsManager.class);
            return subId >= 0 ? base.createForSubscriptionId(subId) : base;
        }
        return subId >= 0 ? SmsManager.getSmsManagerForSubscriptionId(subId) : SmsManager.getDefault();
    }

    private void startSending(String json) {
        final JSONObject req;
        final JSONArray messages;
        try {
            req = new JSONObject(json);
            messages = req.getJSONArray("messages");
        } catch (JSONException e) {
            return;
        }
        final String batch = req.optString("batch", "b");
        final long delay = Math.max(1000, Math.min(30000, req.optLong("delayMs", 3000)));
        int sub = -1;
        try { String sim = req.optString("sim", ""); if (!sim.isEmpty()) sub = Integer.parseInt(sim); } catch (NumberFormatException ignored) { }
        final int subId = sub;
        synchronized (this) { outstanding.put(batch, messages.length()); }

        new Thread(() -> {
            SmsManager sm;
            try {
                sm = smsManagerFor(subId);
            } catch (Exception e) {
                sm = null;
            }
            for (int i = 0; i < messages.length(); i++) {
                JSONObject m = messages.optJSONObject(i);
                if (m == null) continue;
                String id = m.optString("id");
                String phone = m.optString("phone");
                String text = m.optString("text");
                if (i > 0) {
                    try { Thread.sleep(delay); } catch (InterruptedException ignored) { }
                }
                if (sm == null) { reportResult(batch, id, false, "SIM karta topilmadi"); continue; }
                if (phone.isEmpty() || text.isEmpty()) { reportResult(batch, id, false, "Raqam yoki matn bo'sh"); continue; }
                try {
                    ArrayList<String> parts = sm.divideMessage(text);
                    ArrayList<PendingIntent> sentIntents = new ArrayList<>();
                    String key = batch + "|" + id;
                    synchronized (this) { partState.put(key, new int[]{parts.size(), 0, 0}); }
                    for (int p = 0; p < parts.size(); p++) {
                        Intent it = new Intent(ACTION_SENT);
                        it.setPackage(getPackageName());
                        it.putExtra("batch", batch);
                        it.putExtra("id", id);
                        sentIntents.add(PendingIntent.getBroadcast(this, requestCodes.incrementAndGet(), it,
                                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT));
                    }
                    if (parts.size() == 1) sm.sendTextMessage(phone, null, text, sentIntents.get(0), null);
                    else sm.sendMultipartTextMessage(phone, null, parts, sentIntents, null);
                } catch (Exception e) {
                    synchronized (this) { partState.remove(batch + "|" + id); }
                    reportResult(batch, id, false, "Yuborilmadi: " + e.getClass().getSimpleName());
                }
            }
            // Operatordan javob kelmagan SMS'larni ma'lum vaqtdan keyin yopamiz.
            ui.postDelayed(() -> timeoutBatch(batch), RESULT_TIMEOUT_MS);
        }, "nasiya-sms").start();
    }

    private void onPartSent(Intent intent, int resultCode) {
        String batch = intent.getStringExtra("batch");
        String id = intent.getStringExtra("id");
        if (batch == null || id == null) return;
        String key = batch + "|" + id;
        boolean finished;
        int failed;
        int lastCode;
        synchronized (this) {
            int[] st = partState.get(key);
            if (st == null) return;
            st[0]--;
            if (resultCode != Activity.RESULT_OK) { st[1]++; st[2] = resultCode; }
            finished = st[0] <= 0;
            failed = st[1];
            lastCode = st[2];
            if (finished) partState.remove(key);
        }
        if (finished) reportResult(batch, id, failed == 0, failed == 0 ? null : errorText(lastCode));
    }

    private static String errorText(int code) {
        switch (code) {
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE: return "Yuborilmadi (SMS paket yoki balansni tekshiring)";
            case SmsManager.RESULT_ERROR_NO_SERVICE: return "Tarmoq yo'q";
            case SmsManager.RESULT_ERROR_RADIO_OFF: return "Parvoz rejimi yoqilgan";
            case SmsManager.RESULT_ERROR_NULL_PDU: return "SMS xatosi";
            case SmsManager.RESULT_ERROR_LIMIT_EXCEEDED: return "Telefon SMS limitiga yetdi";
            default: return "Xato kodi " + code;
        }
    }

    private void reportResult(String batch, String id, boolean ok, String error) {
        JSONObject r = new JSONObject();
        try {
            r.put("batch", batch);
            r.put("id", id);
            r.put("ok", ok);
            if (error != null) r.put("error", error);
        } catch (JSONException ignored) { }
        js("window.__nasiyaSmsResult && window.__nasiyaSmsResult(" + r + ")");
        boolean done = false;
        synchronized (this) {
            Integer left = outstanding.get(batch);
            if (left != null) {
                left = left - 1;
                if (left <= 0) { outstanding.remove(batch); done = true; }
                else outstanding.put(batch, left);
            }
        }
        if (done) js("window.__nasiyaSmsDone && window.__nasiyaSmsDone({\"batch\":" + JSONObject.quote(batch) + "})");
    }

    private void timeoutBatch(String batch) {
        List<String> ids = new ArrayList<>();
        synchronized (this) {
            if (!outstanding.containsKey(batch)) return;
            String prefix = batch + "|";
            for (String k : new ArrayList<>(partState.keySet())) {
                if (k.startsWith(prefix)) { ids.add(k.substring(prefix.length())); partState.remove(k); }
            }
        }
        for (String id : ids) reportResult(batch, id, false, "Operatordan javob kelmadi");
        synchronized (this) {
            if (outstanding.remove(batch) != null) {
                js("window.__nasiyaSmsDone && window.__nasiyaSmsDone({\"batch\":" + JSONObject.quote(batch) + "})");
            }
        }
    }

    private void failAll(String json, String reason) {
        try {
            JSONObject req = new JSONObject(json);
            String batch = req.optString("batch", "b");
            JSONArray messages = req.getJSONArray("messages");
            synchronized (this) { outstanding.put(batch, messages.length()); }
            for (int i = 0; i < messages.length(); i++) {
                JSONObject m = messages.optJSONObject(i);
                if (m != null) reportResult(batch, m.optString("id"), false, reason);
            }
        } catch (JSONException ignored) { }
    }

    private void js(String code) {
        ui.post(() -> web.evaluateJavascript(code, null));
    }

    /* ---------------- zaxira faylini saqlash ---------------- */

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
            return "Yuklamalar/Nasiya/" + safe;
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

    /* ---------------- avto-zaxira ---------------- */

    private static final String AUTO_NAME = "Nasiya-avtozaxira.json";

    private SharedPreferences prefs() {
        return getSharedPreferences("nasiya", MODE_PRIVATE);
    }

    /**
     * Zaxirani Download/Nasiya/Nasiya-avtozaxira.json ga yozadi (har safar ustidan).
     * Fayl umumiy "Download" papkasida, shuning uchun ilova o'chirilsa ham telefonda qoladi.
     * Android 10+ da ruxsat kerak emas. Qaytaradi: fayl URI (yoki eski Android'da null).
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
        @JavascriptInterface
        public String getSims() {
            // Ikki SIM'li telefonda tanlash uchun ro'yxat. Hech qanday ruxsat so'ramaydi:
            // slot, obuna ID va operator nomi ruxsatsiz ochiq ma'lumotlardan olinadi.
            JSONArray arr = new JSONArray();
            try {
                TelephonyManager tm = getSystemService(TelephonyManager.class);
                if (tm == null) return "[]";
                int slots = Build.VERSION.SDK_INT >= 30 ? tm.getActiveModemCount() : tm.getPhoneCount();
                if (slots < 2) return "[]";
                for (int s = 0; s < slots; s++) {
                    if (Build.VERSION.SDK_INT >= 26 && tm.getSimState(s) != TelephonyManager.SIM_STATE_READY) continue;
                    int subId = subIdForSlot(s);
                    if (subId < 0) continue;
                    String carrier = null;
                    try { carrier = tm.createForSubscriptionId(subId).getSimOperatorName(); } catch (Exception ignored) { }
                    JSONObject o = new JSONObject();
                    o.put("id", String.valueOf(subId));
                    o.put("slot", s + 1);
                    o.put("name", "SIM " + (s + 1) + (carrier != null && !carrier.trim().isEmpty() ? " · " + carrier.trim() : ""));
                    arr.put(o);
                }
            } catch (Exception ignored) { }
            return arr.length() < 2 ? "[]" : arr.toString();
        }

        @JavascriptInterface
        public void sendSms(String json) {
            if (granted(Manifest.permission.SEND_SMS)) {
                startSending(json);
            } else {
                pendingSmsJson = json;
                ui.post(MainActivity.this::requestSmsPermissions);
            }
        }

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
                    send.putExtra(Intent.EXTRA_TEXT, "Nasiya daftari zaxirasi");
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
