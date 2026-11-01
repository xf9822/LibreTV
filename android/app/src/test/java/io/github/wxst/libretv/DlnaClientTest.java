package io.github.wxst.libretv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DlnaClientTest {
    private static final String DESCRIPTION = "<?xml version=\"1.0\"?><root><device>"
            + "<friendlyName>客厅电视 &amp; 乐播</friendlyName><manufacturer>Hisense</manufacturer><modelName>E7K</modelName>"
            + "<UDN>uuid:tv-1</UDN><serviceList>"
            + "<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service>"
            + "<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>upnp/control/AVTransport1</controlURL></service>"
            + "</serviceList></device></root>";

    @Test
    public void findsTheAvTransportControlUrlRelativeToTheDescription() throws Exception {
        DlnaClient.Device device = DlnaClient.parseDescription("http://192.168.1.20:49152/desc/device.xml", DESCRIPTION);
        assertEquals("uuid:tv-1", device.id);
        assertEquals("客厅电视 & 乐播", device.name);
        assertEquals("Hisense E7K", device.model);
        assertEquals("http://192.168.1.20:49152/desc/upnp/control/AVTransport1", device.controlUrl);
    }

    @Test
    public void honoursUrlBaseAndSkipsDevicesWithoutAvTransport() throws Exception {
        String withBase = DESCRIPTION.replace("<device>", "<URLBase>http://192.168.1.20:8080/</URLBase><device>");
        assertEquals("http://192.168.1.20:8080/upnp/control/AVTransport1",
                DlnaClient.parseDescription("http://192.168.1.20:49152/desc.xml", withBase).controlUrl);
        String router = "<root><device><friendlyName>Router</friendlyName><serviceList><service>"
                + "<serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl</controlURL>"
                + "</service></serviceList></device></root>";
        assertNull(DlnaClient.parseDescription("http://192.168.1.1/desc.xml", router));
    }

    @Test
    public void escapesTheUrlAndTitleTwiceInsideTheMetadata() {
        String didl = DlnaClient.didl("http://cdn.example.com/a.m3u8?x=1&y=2", "第1集 <预告>");
        assertTrue(didl.contains("application/vnd.apple.mpegurl"));
        assertTrue(didl.contains("x=1&amp;y=2"));
        assertTrue(didl.contains("第1集 &lt;预告&gt;"));
        String envelope = DlnaClient.envelope("SetAVTransportURI", "<CurrentURIMetaData>" + DlnaClient.escape(didl) + "</CurrentURIMetaData>");
        assertTrue(envelope.contains("&lt;DIDL-Lite"));
        assertTrue(envelope.contains("x=1&amp;amp;y=2"));
        assertTrue(envelope.contains("SetAVTransportURI xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\""));
    }

    @Test
    public void formatsSeekTargetsAndReadsSsdpHeaders() {
        assertEquals("01:02:05", DlnaClient.clock(3725.4));
        assertEquals("00:00:00", DlnaClient.clock(-3));
        assertEquals("http://192.168.1.20:49152/desc.xml",
                DlnaClient.header("HTTP/1.1 200 OK\r\nCache-Control: max-age=1800\r\nLocation: http://192.168.1.20:49152/desc.xml\r\n\r\n", "LOCATION"));
        assertTrue(DlnaClient.searchMessage(DlnaClient.AV_TRANSPORT).startsWith("M-SEARCH * HTTP/1.1\r\n"));
    }
}
