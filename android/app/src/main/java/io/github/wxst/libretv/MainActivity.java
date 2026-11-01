package io.github.wxst.libretv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * LibreTV 安卓外壳：全屏 WebView 打开用户自己部署的 LibreTV 网站，并补上浏览器做不到的事：
 * DLNA 投屏到电视、有声自动播放、视频全屏时横屏。网站地址在第一次打开时输入，之后记住。
 */
public class MainActivity extends Activity {
    private static final String PREFS = "libretv";
    private static final String KEY_SITE = "site_url";
    private static final int FILE_CHOOSER_REQUEST = 41;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final DlnaClient dlna = new DlnaClient();

    private FrameLayout root;
    private WebView webView;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private ValueCallback<Uri[]> fileCallback;
    private String siteUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#07070d"));
        setContentView(root);
        // 安卓 15 起应用默认铺满全屏（edge-to-edge），状态栏、导航栏、刘海和键盘会盖住网页：
        // 用这些区域的大小给页面留出边距；全屏看视频时不留，让画面占满屏幕。
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            applySystemBarPadding(view, insets);
            return insets;
        });
        if (BuildConfig.IS_TV) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            // 电视一直横屏、不息屏
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        siteUrl = prefs().getString(KEY_SITE, "");
        if (siteUrl.isEmpty()) showSetup(null);
        else openSite();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    // ---- 首次打开：输入网站地址 ----

    private void showSetup(String error) {
        exitFullscreen();
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        root.removeAllViews();

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        int pad = dp(28);
        box.setPadding(pad, pad, pad, pad);

        TextView title = text("LibreTV", 28, Color.WHITE);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        box.addView(title);
        TextView intro = text("输入你部署的 LibreTV 网站地址，只需要输入一次，之后打开 App 会直接进入。", 15, Color.parseColor("#a1a5c0"));
        intro.setPadding(0, dp(10), 0, dp(18));
        box.addView(intro);

        EditText input = new EditText(this);
        input.setHint("例如 tv.example.com");
        input.setText(siteUrl);
        input.setSingleLine(true);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.parseColor("#6e7290"));
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView errorView = text(error == null ? "" : error, 14, Color.parseColor("#f87171"));
        errorView.setPadding(0, dp(8), 0, 0);
        box.addView(errorView);

        Button open = new Button(this);
        open.setText("打开");
        open.setAllCaps(false);
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        buttonParams.topMargin = dp(16);
        box.addView(open, buttonParams);

        Runnable submit = () -> {
            String normalized = normalizeSiteUrl(input.getText().toString());
            if (normalized == null) {
                errorView.setText("请输入正确的网址，例如 tv.example.com 或 https://tv.example.com");
                return;
            }
            siteUrl = normalized;
            prefs().edit().putString(KEY_SITE, siteUrl).apply();
            openSite();
        };
        open.setOnClickListener(v -> submit.run());
        input.setOnEditorActionListener((v, actionId, event) -> {
            submit.run();
            return true;
        });
        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** 补全协议、去掉多余部分；不像网址时返回 null。 */
    static String normalizeSiteUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty() || value.contains(" ")) return null;
        if (!value.matches("(?i)^https?://.*")) value = "https://" + value;
        Uri uri = Uri.parse(value);
        String host = uri.getHost();
        if (host == null || !host.contains(".") && !"localhost".equals(host)) return null;
        String port = uri.getPort() > 0 ? ":" + uri.getPort() : "";
        return uri.getScheme().toLowerCase(java.util.Locale.ROOT) + "://" + host + port + "/";
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setTextColor(color);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    // ---- 网站 ----

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void openSite() {
        root.removeAllViews();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#07070d"));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // 浏览器要先点一下才肯出声；App 里直接有声自动播放
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 网站是 https，资源站的视频常是 http
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // 网站据此识别 App；电视版再加 TV，网站会切换成遥控器操作的界面
        settings.setUserAgentString(settings.getUserAgentString() + " LibreTVApp/" + appVersion() + (BuildConfig.IS_TV ? " TV" : ""));
        webView.addJavascriptInterface(new Bridge(), "LibreTVApp");
        webView.setWebViewClient(new SiteClient());
        webView.setWebChromeClient(new Chrome());
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl(siteUrl);
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    private boolean isSameSite(Uri uri) {
        Uri site = Uri.parse(siteUrl);
        return uri.getHost() != null && uri.getHost().equalsIgnoreCase(site.getHost());
    }

    private final class SiteClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            if ((scheme.equals("http") || scheme.equals("https")) && isSameSite(uri)) return false;
            // 豆瓣、GitHub 等外站链接交给系统浏览器
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            new AlertDialog.Builder(MainActivity.this)
                    .setTitle("打不开网站")
                    .setMessage(siteUrl + "\n\n" + error.getDescription() + "\n\n请检查网络，或确认网址是否正确。")
                    .setPositiveButton("重试", (d, w) -> view.reload())
                    .setNegativeButton("更换网址", (d, w) -> showSetup(null))
                    .setCancelable(false)
                    .show();
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            setSystemBarsHidden(true);
            root.requestApplyInsets();
            // 全屏看视频时横屏（跟随重力在两个横屏方向之间切换）
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            // 「导入配置」选择文件
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                return true;
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarPadding(View view, WindowInsets insets) {
        if (fullscreenView != null) {
            view.setPadding(0, 0, 0, 0);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
        } else {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
        }
    }

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        setSystemBarsHidden(false);
        root.requestApplyInsets();
        setRequestedOrientation(BuildConfig.IS_TV ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    @SuppressWarnings("deprecation")
    private void setSystemBarsHidden(boolean on) {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller == null) return;
            if (on) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                controller.show(WindowInsets.Type.systemBars());
            }
        } else {
            window.getDecorView().setSystemUiVisibility(on
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    : View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (fullscreenView != null) {
                exitFullscreen();
                return true;
            }
            if (webView != null) {
                // 先让网页处理（关闭选集、设置面板，退出网页全屏），网页没处理再后退或退出 App
                webView.evaluateJavascript("(function(){try{return window.LibreTVBack&&window.LibreTVBack()===true}catch(e){return false}})()", handled -> {
                    if ("true".equals(handled)) return;
                    if (webView != null && webView.canGoBack()) webView.goBack();
                    else finish();
                });
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        worker.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    // ---- 网页调用的接口：window.LibreTVApp ----

    private void callPage(String function, JSONObject payload) {
        String script = "window.LibreTVCast && window.LibreTVCast." + function + "(" + payload + ")";
        main.post(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private final class Bridge {
        @JavascriptInterface
        public String version() {
            return appVersion();
        }

        @JavascriptInterface
        public String siteUrl() {
            return siteUrl;
        }

        @JavascriptInterface
        public void changeSite() {
            main.post(() -> showSetup(null));
        }

        @JavascriptInterface
        public void keepScreenOn(boolean on) {
            main.post(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        /** 在局域网里查找电视，结果回调 LibreTVCast.onDevices({ devices, error }) */
        @JavascriptInterface
        public void discover() {
            worker.execute(() -> {
                JSONObject result = new JSONObject();
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                WifiManager.MulticastLock lock = wifi == null ? null : wifi.createMulticastLock("libretv-dlna");
                try {
                    if (lock != null) {
                        lock.setReferenceCounted(false);
                        lock.acquire();
                    }
                    List<DlnaClient.Device> devices = dlna.search(4000);
                    JSONArray list = new JSONArray();
                    for (DlnaClient.Device device : devices) {
                        list.put(new JSONObject().put("id", device.id).put("name", device.name).put("model", device.model));
                    }
                    result.put("devices", list);
                } catch (Exception e) {
                    try {
                        result.put("devices", new JSONArray()).put("error", "查找失败：" + e.getMessage());
                    } catch (Exception ignored) {
                    }
                } finally {
                    if (lock != null && lock.isHeld()) lock.release();
                }
                callPage("onDevices", result);
            });
        }

        /** 投屏；action 为 play / pause / resume / stop / seek，结果回调 LibreTVCast.onResult({ action, ok, error }) */
        @JavascriptInterface
        public void control(String deviceId, String action, String url, String title, double seconds) {
            worker.execute(() -> {
                JSONObject result = new JSONObject();
                try {
                    result.put("action", action);
                    DlnaClient.Device device = dlna.find(deviceId);
                    if (device == null) throw new IllegalStateException("找不到这台设备，请重新搜索");
                    switch (action) {
                        case "play": dlna.play(device, url, title, seconds); break;
                        case "pause": dlna.pause(device); break;
                        case "resume": dlna.resume(device); break;
                        case "stop": dlna.stop(device); break;
                        case "seek": dlna.seek(device, seconds); break;
                        default: throw new IllegalArgumentException("未知操作：" + action);
                    }
                    result.put("ok", true);
                } catch (Exception e) {
                    try {
                        result.put("ok", false).put("error", e.getMessage() == null ? e.toString() : e.getMessage());
                    } catch (Exception ignored) {
                    }
                }
                callPage("onResult", result);
            });
        }
    }
}
