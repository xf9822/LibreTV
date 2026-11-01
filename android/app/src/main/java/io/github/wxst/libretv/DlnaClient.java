package io.github.wxst.libretv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 最小的 DLNA / UPnP 投屏客户端：用 SSDP 组播在局域网里找到支持 AVTransport 的电视（媒体渲染器），
 * 再用 SOAP 让它播放一个视频地址。电视自己去拉流，手机只负责遥控。
 * 只用 java.net，不依赖 Android 类，方便在电脑上的 JVM 里测试。
 */
public final class DlnaClient {
    public static final String AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
    private static final String SSDP_ADDRESS = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final int HTTP_TIMEOUT_MS = 4000;

    /** 局域网里找到的一台可投屏设备。 */
    public static final class Device {
        public final String id;
        public final String name;
        public final String model;
        public final String controlUrl;

        Device(String id, String name, String model, String controlUrl) {
            this.id = id;
            this.name = name;
            this.model = model;
            this.controlUrl = controlUrl;
        }
    }

    private final Map<String, Device> devices = new LinkedHashMap<>();

    public synchronized Device find(String id) {
        return devices.get(id);
    }

    /**
     * 发出 M-SEARCH 并在 timeoutMs 内收集应答，返回去重后的设备（按发现顺序）。
     * 搜索两种目标：直接带 AVTransport 服务的，以及只声明为 MediaRenderer 的。
     */
    public List<Device> search(int timeoutMs) throws IOException {
        Set<String> locations = new LinkedHashSet<>();
        try (MulticastSocket socket = new MulticastSocket()) {
            socket.setTimeToLive(4);
            socket.setSoTimeout(400);
            InetAddress group = InetAddress.getByName(SSDP_ADDRESS);
            String[] targets = {AV_TRANSPORT, "urn:schemas-upnp-org:device:MediaRenderer:1"};
            long deadline = System.currentTimeMillis() + timeoutMs;
            int round = 0;
            byte[] buffer = new byte[4096];
            while (System.currentTimeMillis() < deadline) {
                // 组播包可能丢失：开头和中途各发一轮
                if (round == 0 || (round == 1 && System.currentTimeMillis() > deadline - timeoutMs / 2)) {
                    sendSearch(socket, group, targets);
                    round++;
                }
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException ignored) {
                    continue;
                }
                String location = header(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8), "LOCATION");
                if (location != null && location.startsWith("http")) locations.add(location.trim());
            }
        }

        List<Device> found = new ArrayList<>();
        for (String location : locations) {
            try {
                Device device = describe(location);
                if (device != null && found.stream().noneMatch(d -> d.id.equals(device.id))) found.add(device);
            } catch (IOException ignored) {
                // 有的设备描述地址打不开（不是电视、已离线），跳过
            }
        }
        synchronized (this) {
            for (Device device : found) devices.put(device.id, device);
        }
        return found;
    }

    /**
     * 从每个可用的局域网网卡（Wi-Fi、有线）各发一遍 M-SEARCH：只用系统默认网卡时，
     * 有的手机会把组播发到移动数据或 VPN 上，同一 Wi-Fi 里的电视就收不到。
     */
    private static void sendSearch(MulticastSocket socket, InetAddress group, String[] targets) throws IOException {
        List<NetworkInterface> interfaces = lanInterfaces();
        boolean sent = false;
        for (NetworkInterface network : interfaces) {
            try {
                socket.setNetworkInterface(network);
                for (String target : targets) send(socket, group, target);
                sent = true;
            } catch (IOException ignored) {
                // 这块网卡发不出去（未连接、没有组播路由），试下一块
            }
        }
        if (!sent) {
            for (String target : targets) send(socket, group, target);
        }
    }

    private static void send(MulticastSocket socket, InetAddress group, String target) throws IOException {
        byte[] message = searchMessage(target).getBytes(StandardCharsets.UTF_8);
        socket.send(new DatagramPacket(message, message.length, group, SSDP_PORT));
    }

    static List<NetworkInterface> lanInterfaces() {
        List<NetworkInterface> result = new ArrayList<>();
        try {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback() || !network.supportsMulticast() || network.isVirtual()) continue;
                String name = network.getName().toLowerCase(Locale.ROOT);
                // 移动数据、VPN 隧道上没有电视
                if (name.startsWith("rmnet") || name.startsWith("ccmni") || name.startsWith("tun") || name.startsWith("ppp")) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        result.add(network);
                        break;
                    }
                }
            }
        } catch (IOException ignored) {
        }
        return result;
    }

    static String searchMessage(String target) {
        return "M-SEARCH * HTTP/1.1\r\n"
                + "HOST: " + SSDP_ADDRESS + ":" + SSDP_PORT + "\r\n"
                + "MAN: \"ssdp:discover\"\r\n"
                + "MX: 2\r\n"
                + "ST: " + target + "\r\n"
                + "USER-AGENT: Android/1 UPnP/1.1 LibreTV/1.0\r\n\r\n";
    }

    static String header(String response, String name) {
        for (String line : response.split("\r?\n")) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase(name)) {
                return line.substring(colon + 1).trim();
            }
        }
        return null;
    }

    /** 读取设备描述，找出 AVTransport 服务的控制地址；没有这个服务的设备（路由器、音箱的其他服务）返回 null。 */
    public Device describe(String location) throws IOException {
        String xml = httpGet(location);
        return parseDescription(location, xml);
    }

    static Device parseDescription(String location, String xml) throws IOException {
        String controlPath = null;
        Matcher services = Pattern.compile("<service>(.*?)</service>", Pattern.DOTALL | Pattern.CASE_INSENSITIVE).matcher(xml);
        while (services.find()) {
            String block = services.group(1);
            String type = tag(block, "serviceType");
            if (type != null && type.contains(":service:AVTransport:")) {
                controlPath = tag(block, "controlURL");
                break;
            }
        }
        if (controlPath == null) return null;
        String base = tag(xml, "URLBase");
        URL baseUrl = new URL(base != null && !base.isEmpty() ? base : location);
        String controlUrl = new URL(baseUrl, controlPath).toString();
        String udn = tag(xml, "UDN");
        String name = tag(xml, "friendlyName");
        String model = tag(xml, "modelName");
        String manufacturer = tag(xml, "manufacturer");
        String id = udn != null && !udn.isEmpty() ? udn : controlUrl;
        String label = name != null && !name.isEmpty() ? unescape(name) : new URL(location).getHost();
        String detail = joinNonEmpty(manufacturer, model);
        return new Device(id, label, detail, controlUrl);
    }

    private static String joinNonEmpty(String a, String b) {
        StringBuilder out = new StringBuilder();
        for (String part : new String[]{a, b}) {
            if (part == null || part.trim().isEmpty()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(unescape(part.trim()));
        }
        return out.toString();
    }

    static String tag(String xml, String name) {
        Matcher matcher = Pattern.compile("<(?:\\w+:)?" + name + "(?:\\s[^>]*)?>(.*?)</(?:\\w+:)?" + name + ">",
                Pattern.DOTALL | Pattern.CASE_INSENSITIVE).matcher(xml);
        return matcher.find() ? matcher.group(1).trim() : null;
    }

    // ---- 遥控 ----

    /** 让电视播放 url；startSeconds 大于 0 时在开始播放后跳到该位置。 */
    public void play(Device device, String url, String title, double startSeconds) throws IOException {
        String metadata = didl(url, title);
        soap(device, "SetAVTransportURI",
                "<InstanceID>0</InstanceID><CurrentURI>" + escape(url) + "</CurrentURI>"
                        + "<CurrentURIMetaData>" + escape(metadata) + "</CurrentURIMetaData>");
        soap(device, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>");
        if (startSeconds > 5) {
            // 电视开始缓冲后才接受跳转，失败了就从头播放
            for (int attempt = 0; attempt < 4; attempt++) {
                try {
                    Thread.sleep(1500);
                    seek(device, startSeconds);
                    break;
                } catch (IOException | InterruptedException ignored) {
                    if (Thread.currentThread().isInterrupted()) break;
                }
            }
        }
    }

    public void pause(Device device) throws IOException {
        soap(device, "Pause", "<InstanceID>0</InstanceID>");
    }

    public void resume(Device device) throws IOException {
        soap(device, "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>");
    }

    public void stop(Device device) throws IOException {
        soap(device, "Stop", "<InstanceID>0</InstanceID>");
    }

    public void seek(Device device, double seconds) throws IOException {
        soap(device, "Seek", "<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>" + clock(seconds) + "</Target>");
    }

    static String clock(double seconds) {
        long total = Math.max(0, Math.round(seconds));
        return String.format(Locale.ROOT, "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60);
    }

    static String didl(String url, String title) {
        String mime = url.toLowerCase(Locale.ROOT).contains(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4";
        return "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" "
                + "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
                + "<item id=\"0\" parentID=\"-1\" restricted=\"1\">"
                + "<dc:title>" + escape(title == null || title.isEmpty() ? "LibreTV" : title) + "</dc:title>"
                + "<upnp:class>object.item.videoItem</upnp:class>"
                + "<res protocolInfo=\"http-get:*:" + mime + ":*\">" + escape(url) + "</res>"
                + "</item></DIDL-Lite>";
    }

    static String envelope(String action, String arguments) {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
                + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
                + "<u:" + action + " xmlns:u=\"" + AV_TRANSPORT + "\">" + arguments + "</u:" + action + ">"
                + "</s:Body></s:Envelope>";
    }

    private void soap(Device device, String action, String arguments) throws IOException {
        byte[] body = envelope(action, arguments).getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) new URL(device.controlUrl).openConnection();
        connection.setConnectTimeout(HTTP_TIMEOUT_MS);
        connection.setReadTimeout(HTTP_TIMEOUT_MS);
        connection.setDoOutput(true);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
        connection.setRequestProperty("SOAPACTION", "\"" + AV_TRANSPORT + "#" + action + "\"");
        connection.setFixedLengthStreamingMode(body.length);
        try (OutputStream out = connection.getOutputStream()) {
            out.write(body);
        }
        int status = connection.getResponseCode();
        if (status >= 300) {
            String detail = "";
            try (InputStream error = connection.getErrorStream()) {
                if (error != null) detail = tag(readAll(error), "errorDescription");
            } catch (IOException ignored) {
            }
            throw new IOException(action + " 失败（HTTP " + status + (detail != null && !detail.isEmpty() ? "，" + detail : "") + "）");
        }
        try (InputStream in = connection.getInputStream()) {
            readAll(in);
        }
    }

    private static String httpGet(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(HTTP_TIMEOUT_MS);
        connection.setReadTimeout(HTTP_TIMEOUT_MS);
        try (InputStream in = connection.getInputStream()) {
            return readAll(in);
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        return out.toString("UTF-8");
    }

    static String escape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
    }

    static String unescape(String value) {
        return value.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&");
    }
}
