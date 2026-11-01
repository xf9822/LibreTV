// 画质增强：在浏览器里用 GPU（WebGL2）实时放大和锐化画面，不依赖显卡品牌，Windows / Mac / Android / iOS 通用。
// Algorithm: AMD FidelityFX Super Resolution 1.0 (MIT) — EASU edge-adaptive upscaling to the displayed size,
// then RCAS contrast-adaptive sharpening with noise detection. The video stays in the page (hidden) and a
// canvas on top shows the processed frames; a frame is drawn only when the video presents a new one.
(() => {
    const STORAGE_KEY = 'videoEnhanceMode';
    const MODES = {
        off: { label: '关闭' },
        standard: { label: '标准', sharpness: 0.25 },   // RCAS "stops": 0 is the sharpest
        sharp: { label: '锐利', sharpness: 0.0 },
        // TC / low-bitrate copies: deblock + denoise and automatic levels before upscaling, then gentle sharpening.
        restore: { label: '低画质修复', sharpness: 0.6, restore: true }
    };
    const STATS_SIZE = { width: 64, height: 36 };
    const STATS_INTERVAL_MS = 1000;
    const MAX_PIXELS = 3840 * 2160;
    const MAX_DPR = 2;

    const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

    // EASU in pixel space. Image rows go top to bottom; gl_FragCoord goes bottom to top, hence the flip.
    const EASU = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 sourceSize;
uniform vec2 outputSize;
uniform bool upscale;
out vec4 color;

vec3 tap(ivec2 p) { return texelFetch(source, clamp(p, ivec2(0), ivec2(sourceSize) - 1), 0).rgb; }
float luma(vec3 c) { return c.g + 0.5 * (c.r + c.b); }

void setDirection(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
    float lenX = max(abs(lD - lC), abs(lC - lB));
    float dirX = lD - lB;
    dir.x += dirX * w;
    lenX = clamp(abs(dirX) / max(lenX, 1e-5), 0.0, 1.0);
    len += lenX * lenX * w;
    float lenY = max(abs(lE - lC), abs(lC - lA));
    float dirY = lE - lA;
    dir.y += dirY * w;
    lenY = clamp(abs(dirY) / max(lenY, 1e-5), 0.0, 1.0);
    len += lenY * lenY * w;
}

void accumulate(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len2, float lob, float clp, vec3 c) {
    vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len2;
    float d2 = min(dot(v, v), clp);
    float wB = 0.4 * d2 - 1.0;
    float wA = lob * d2 - 1.0;
    wB *= wB;
    wA *= wA;
    wB = 1.5625 * wB - 0.5625;
    float w = wB * wA;
    aC += c * w;
    aW += w;
}

void main() {
    vec2 outPos = vec2(gl_FragCoord.x, outputSize.y - gl_FragCoord.y);
    vec2 pp = outPos * (sourceSize / outputSize) - 0.5;
    if (!upscale) {
        color = vec4(texture(source, (pp + 0.5) / sourceSize).rgb, 1.0);
        return;
    }
    vec2 fp = floor(pp);
    pp -= fp;
    ivec2 f = ivec2(fp);
    //    b c
    //  e F g h
    //  i j k l
    //    n o
    vec3 bC = tap(f + ivec2(0, -1)); vec3 cC = tap(f + ivec2(1, -1));
    vec3 eC = tap(f + ivec2(-1, 0)); vec3 fC = tap(f);               vec3 gC = tap(f + ivec2(1, 0)); vec3 hC = tap(f + ivec2(2, 0));
    vec3 iC = tap(f + ivec2(-1, 1)); vec3 jC = tap(f + ivec2(0, 1)); vec3 kC = tap(f + ivec2(1, 1)); vec3 lC = tap(f + ivec2(2, 1));
    vec3 nC = tap(f + ivec2(0, 2)); vec3 oC = tap(f + ivec2(1, 2));
    float bL = luma(bC), cL = luma(cC), eL = luma(eC), fL = luma(fC), gL = luma(gC), hL = luma(hC);
    float iL = luma(iC), jL = luma(jC), kL = luma(kC), lL = luma(lC), nL = luma(nC), oL = luma(oC);

    vec2 dir = vec2(0.0);
    float len = 0.0;
    setDirection(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
    setDirection(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
    setDirection(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
    setDirection(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);

    vec2 dir2 = dir * dir;
    float dirR = dir2.x + dir2.y;
    bool zero = dirR < (1.0 / 32768.0);
    dirR = zero ? 1.0 : inversesqrt(dirR);
    dir.x = zero ? 1.0 : dir.x;
    dir *= dirR;
    len = len * 0.5;
    len *= len;
    float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    float lob = 0.5 - 0.29 * len;
    float clp = 1.0 / lob;

    vec3 min4 = min(min(fC, gC), min(jC, kC));
    vec3 max4 = max(max(fC, gC), max(jC, kC));
    vec3 aC = vec3(0.0);
    float aW = 0.0;
    accumulate(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, bC);
    accumulate(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, cC);
    accumulate(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, iC);
    accumulate(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, jC);
    accumulate(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, fC);
    accumulate(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, eC);
    accumulate(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, kC);
    accumulate(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, lC);
    accumulate(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, hC);
    accumulate(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, gC);
    accumulate(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, oC);
    accumulate(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, nC);
    color = vec4(clamp(aC / aW, min4, max4), 1.0);
}`;

    // RCAS on the upscaled image (same orientation as the canvas, so no flip here).
    const RCAS = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform float sharpness;
out vec4 color;

vec3 tap(ivec2 p) { return texelFetch(source, clamp(p, ivec2(0), textureSize(source, 0) - 1), 0).rgb; }
float luma(vec3 c) { return c.g + 0.5 * (c.r + c.b); }

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec3 b = tap(p + ivec2(0, 1));
    vec3 d = tap(p + ivec2(-1, 0));
    vec3 e = tap(p);
    vec3 f = tap(p + ivec2(1, 0));
    vec3 h = tap(p + ivec2(0, -1));
    float bL = luma(b), dL = luma(d), eL = luma(e), fL = luma(f), hL = luma(h);
    // Noise detection: soften sharpening where the centre stands out from all its neighbours.
    float range = max(max(max(bL, dL), max(fL, hL)), eL) - min(min(min(bL, dL), min(fL, hL)), eL);
    float nz = 0.25 * (bL + dL + fL + hL) - eL;
    nz = clamp(abs(nz) / max(range, 1e-5), 0.0, 1.0);
    nz = -0.5 * nz + 1.0;
    vec3 mn4 = min(min(b, d), min(f, h));
    vec3 mx4 = max(max(b, d), max(f, h));
    vec3 hitMin = mn4 / (4.0 * mx4 + 1e-5);
    vec3 hitMax = (1.0 - mx4) / (4.0 * mn4 - 4.0 - 1e-5);
    vec3 lobeRGB = max(-hitMin, hitMax);
    float lobe = max(-(0.25 - 1.0 / 16.0), min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * exp2(-sharpness);
    lobe *= nz;
    float rcpL = 1.0 / (4.0 * lobe + 1.0);
    color = vec4(clamp((lobe * (b + d + f + h) + e) * rcpL, 0.0, 1.0), 1.0);
}`;

    // Edge-preserving smoothing at source resolution: neighbours count by distance and by how close their
    // brightness is, so compression blocks and noise (small steps) are smoothed while real edges stay.
    // Then the automatic levels stretch a washed-out picture and saturation is lifted a little.
    const RESTORE = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 levels;
uniform float saturation;
out vec4 color;

const vec3 Y = vec3(0.299, 0.587, 0.114);
vec3 tap(ivec2 p) { return texelFetch(source, clamp(p, ivec2(0), textureSize(source, 0) - 1), 0).rgb; }

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec3 center = tap(p);
    float centerY = dot(center, Y);
    vec3 sum = vec3(0.0);
    float weights = 0.0;
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec3 sample_ = tap(p + ivec2(x, y));
            float d = dot(sample_, Y) - centerY;
            float w = exp(-float(x * x + y * y) / 4.5) * exp(-d * d / 0.0128);
            sum += sample_ * w;
            weights += w;
        }
    }
    vec3 c = mix(center, sum / weights, 0.85);
    c = clamp((c - levels.x) / max(levels.y - levels.x, 0.05), 0.0, 1.0);
    float l = dot(c, Y);
    color = vec4(clamp(mix(vec3(l), c, saturation), 0.0, 1.0), 1.0);
}`;

    // Black and white points from a small RGBA thumbnail: 1st and 99th percentile of luma, leaving out
    // letterbox black. Bounded so a dark or bright scene is never pushed to an extreme.
    function computeLevels(rgba) {
        const lumas = [];
        for (let i = 0; i < rgba.length; i += 4) {
            const y = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255;
            if (y > 0.02) lumas.push(y);
        }
        if (lumas.length < rgba.length / 4 * 0.2) return { lo: 0, hi: 1 };
        lumas.sort((a, b) => a - b);
        let lo = Math.min(lumas[Math.floor(lumas.length * 0.01)], 0.2);
        let hi = Math.max(lumas[Math.ceil(lumas.length * 0.99) - 1], 0.75);
        if (hi - lo < 0.5) lo = Math.max(0, hi - 0.5);
        return { lo, hi };
    }

    // Gradual changes, so levels follow a scene without flickering.
    function blendLevels(previous, next, amount = 0.3) {
        if (!previous) return next;
        return { lo: previous.lo + (next.lo - previous.lo) * amount, hi: previous.hi + (next.hi - previous.hi) * amount };
    }

    function readMode() {
        try { const mode = localStorage.getItem(STORAGE_KEY); return MODES[mode] ? mode : 'off'; } catch { return 'off'; }
    }
    function writeMode(mode) {
        try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* storage blocked */ }
    }

    // Where the picture sits inside the player (object-fit: contain), in CSS pixels.
    function contentRect(boxWidth, boxHeight, videoWidth, videoHeight) {
        if (!(boxWidth > 0 && boxHeight > 0 && videoWidth > 0 && videoHeight > 0)) return null;
        const scale = Math.min(boxWidth / videoWidth, boxHeight / videoHeight);
        const width = videoWidth * scale;
        const height = videoHeight * scale;
        return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height };
    }

    // Drawing-buffer size for a rect: device pixels, capped for slow devices and huge screens.
    function outputSize(rect, devicePixelRatio, maxDpr = MAX_DPR) {
        let ratio = Math.min(devicePixelRatio || 1, maxDpr);
        let width = Math.round(rect.width * ratio);
        let height = Math.round(rect.height * ratio);
        if (width * height > MAX_PIXELS) {
            const shrink = Math.sqrt(MAX_PIXELS / (width * height));
            width = Math.floor(width * shrink);
            height = Math.floor(height * shrink);
        }
        return { width: Math.max(1, width), height: Math.max(1, height) };
    }

    function compile(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || '着色器编译失败');
        return shader;
    }

    function program(gl, fragment) {
        const result = gl.createProgram();
        gl.attachShader(result, compile(gl, gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(result, compile(gl, gl.FRAGMENT_SHADER, fragment));
        gl.bindAttribLocation(result, 0, 'position');
        gl.linkProgram(result);
        if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) || '着色器链接失败');
        return result;
    }

    function texture(gl, filter) {
        const result = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, result);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return result;
    }

    function isSupported() {
        try { return Boolean(document.createElement('canvas').getContext('webgl2')); } catch { return false; }
    }

    // One enhancer per player. host: the player element (.art-video-player); video: its <video>.
    function create({ host, video, notify = () => {} }) {
        const canvas = document.createElement('canvas');
        canvas.className = 'video-enhance-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.hidden = true;
        video.after(canvas);

        let gl = null;
        let easu = null;
        let rcas = null;
        let restore = null;
        let sourceTexture = null;
        let restoreTexture = null;
        let statsTexture = null;
        let restoreSize = '';
        let levels = null;
        let statsAt = 0;
        let middleTexture = null;
        let framebuffer = null;
        let mode = 'off';
        let frameRequest = 0;
        let usesFrameCallback = false;
        let maxDpr = MAX_DPR;
        let size = { width: 0, height: 0 };
        let last = { source: '', output: '' };
        let watchdog = 0;
        let quality = null;
        let resizeObserver = null;
        let destroyed = false;

        function setup() {
            if (gl) return true;
            gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
            if (!gl) return false;
            easu = program(gl, EASU);
            rcas = program(gl, RCAS);
            restore = program(gl, RESTORE);
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            sourceTexture = texture(gl, gl.LINEAR);
            middleTexture = texture(gl, gl.NEAREST);
            restoreTexture = texture(gl, gl.LINEAR);
            statsTexture = texture(gl, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, STATS_SIZE.width, STATS_SIZE.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            framebuffer = gl.createFramebuffer();
            // A lost context (GPU reset, Android reclaiming it in the background) would leave the
            // video hidden behind a dead canvas: fall back to the plain picture.
            canvas.addEventListener('webglcontextlost', event => {
                event.preventDefault();
                stop();
                gl = null;
                onContextLost();
            }, { once: true });
            return true;
        }

        function layout() {
            const rect = contentRect(host.clientWidth, host.clientHeight, video.videoWidth, video.videoHeight);
            if (!rect) return false;
            Object.assign(canvas.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
            const next = outputSize(rect, window.devicePixelRatio, maxDpr);
            if (next.width !== size.width || next.height !== size.height) {
                size = next;
                canvas.width = size.width;
                canvas.height = size.height;
                gl.bindTexture(gl.TEXTURE_2D, middleTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            }
            return true;
        }

        function render() {
            if (!gl || mode === 'off' || video.readyState < 2 || !layout()) return;
            const width = video.videoWidth;
            const height = video.videoHeight;
            gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
            } catch (error) {
                // A cross-origin source without CORS cannot be read.
                setMode('off', { remember: false });
                notify('这个视频的来源不允许画质增强，已恢复原画');
                return;
            }
            let input = sourceTexture;
            if (MODES[mode].restore) {
                updateLevels(width, height);
                if (restoreSize !== `${width}x${height}`) {
                    restoreSize = `${width}x${height}`;
                    gl.bindTexture(gl.TEXTURE_2D, restoreTexture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, restoreTexture, 0);
                gl.viewport(0, 0, width, height);
                gl.useProgram(restore);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
                gl.uniform1i(gl.getUniformLocation(restore, 'source'), 0);
                gl.uniform2f(gl.getUniformLocation(restore, 'levels'), levels.lo, levels.hi);
                gl.uniform1f(gl.getUniformLocation(restore, 'saturation'), 1.1);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                input = restoreTexture;
            }
            // Pass 1: EASU to the display size.
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, middleTexture, 0);
            gl.viewport(0, 0, size.width, size.height);
            gl.useProgram(easu);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, input);
            gl.uniform1i(gl.getUniformLocation(easu, 'source'), 0);
            gl.uniform2f(gl.getUniformLocation(easu, 'sourceSize'), width, height);
            gl.uniform2f(gl.getUniformLocation(easu, 'outputSize'), size.width, size.height);
            gl.uniform1i(gl.getUniformLocation(easu, 'upscale'), size.width > width || size.height > height ? 1 : 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            // Pass 2: RCAS to the canvas.
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.useProgram(rcas);
            gl.bindTexture(gl.TEXTURE_2D, middleTexture);
            gl.uniform1i(gl.getUniformLocation(rcas, 'source'), 0);
            gl.uniform1f(gl.getUniformLocation(rcas, 'sharpness'), MODES[mode].sharpness);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            // Follow the brightness gesture of the mobile fullscreen layer.
            if (canvas.style.filter !== video.style.filter) canvas.style.filter = video.style.filter;
            last = { source: `${width}×${height}`, output: `${size.width}×${size.height}` };
        }

        // Once a second: draw the frame into a 64×36 thumbnail and read it back for the level statistics.
        function updateLevels(width, height) {
            const now = performance.now();
            if (levels && now - statsAt < STATS_INTERVAL_MS) return;
            statsAt = now;
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, statsTexture, 0);
            gl.viewport(0, 0, STATS_SIZE.width, STATS_SIZE.height);
            gl.useProgram(easu);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
            gl.uniform1i(gl.getUniformLocation(easu, 'source'), 0);
            gl.uniform2f(gl.getUniformLocation(easu, 'sourceSize'), width, height);
            gl.uniform2f(gl.getUniformLocation(easu, 'outputSize'), STATS_SIZE.width, STATS_SIZE.height);
            gl.uniform1i(gl.getUniformLocation(easu, 'upscale'), 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const pixels = new Uint8Array(STATS_SIZE.width * STATS_SIZE.height * 4);
            gl.readPixels(0, 0, STATS_SIZE.width, STATS_SIZE.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            levels = blendLevels(levels, computeLevels(pixels));
        }

        function loop() {
            render();
            schedule();
        }

        function schedule() {
            if (mode === 'off') return;
            if (typeof video.requestVideoFrameCallback === 'function') {
                usesFrameCallback = true;
                frameRequest = video.requestVideoFrameCallback(loop);
            } else if (!video.paused) {
                frameRequest = requestAnimationFrame(loop);
            }
        }

        function stop() {
            if (frameRequest) {
                if (usesFrameCallback) video.cancelVideoFrameCallback?.(frameRequest);
                else cancelAnimationFrame(frameRequest);
            }
            frameRequest = 0;
            clearInterval(watchdog);
            watchdog = 0;
        }

        // Too slow for this device: first draw at 1× device pixels, then give up.
        function checkPerformance() {
            const now = video.getVideoPlaybackQuality?.();
            if (!now || video.paused) { quality = now || null; return; }
            if (quality) {
                const total = now.totalVideoFrames - quality.totalVideoFrames;
                const dropped = now.droppedVideoFrames - quality.droppedVideoFrames;
                if (total > 30 && dropped / total > 0.2) {
                    if (maxDpr > 1) {
                        maxDpr = 1;
                        render();
                    } else {
                        setMode('off', { remember: false });
                        notify('设备性能不足，已关闭画质增强');
                        return;
                    }
                }
            }
            quality = now;
        }

        const redraw = () => { if (mode !== 'off') { render(); if (!usesFrameCallback && !frameRequest) schedule(); } };
        const onPlay = () => { if (mode !== 'off' && !usesFrameCallback) { stop(); schedule(); startWatchdog(); } };
        const startWatchdog = () => { clearInterval(watchdog); quality = null; watchdog = setInterval(checkPerformance, 4000); };
        ['loadeddata', 'seeked', 'resize', 'pause'].forEach(name => video.addEventListener(name, redraw));
        video.addEventListener('play', onPlay);
        window.addEventListener('resize', redraw);
        if (typeof ResizeObserver === 'function') {
            resizeObserver = new ResizeObserver(redraw);
            resizeObserver.observe(host);
        }

        function onContextLost() {
            if (destroyed || mode === 'off') return;
            setMode('off', { remember: false });
            notify('显卡暂时不可用，画质增强已关闭，可在设置里重新打开');
        }

        function setMode(next, { remember = true } = {}) {
            const wanted = MODES[next] ? next : 'off';
            if (remember) writeMode(wanted);
            stop();
            mode = 'off';
            levels = null;
            if (wanted !== 'off') {
                try {
                    if (!setup()) { notify('这个浏览器不支持 WebGL2，无法开启画质增强'); return 'off'; }
                } catch (error) {
                    console.warn('画质增强初始化失败:', error);
                    notify('画质增强初始化失败，已恢复原画');
                    return 'off';
                }
                mode = wanted;
                maxDpr = MAX_DPR;
                render();
                schedule();
                startWatchdog();
            }
            const on = mode !== 'off';
            canvas.hidden = !on;
            host.classList.toggle('video-enhance-on', on);
            return mode;
        }

        return {
            setMode,
            get mode() { return mode; },
            describe() {
                if (mode === 'off') return '关闭';
                const steps = MODES[mode].restore ? `去块降噪 + 自动对比度${levels ? `（${Math.round(levels.lo * 255)}–${Math.round(levels.hi * 255)}）` : ''} + FSR 1.0` : 'FSR 1.0';
                return `${MODES[mode].label}（${steps}${last.source ? `，${last.source} → ${last.output}` : ''}）`;
            },
            // The processed frame as an image, e.g. for tests or screenshots.
            capture() {
                render();
                return canvas.toDataURL('image/png');
            },
            destroy() {
                destroyed = true;
                stop();
                ['loadeddata', 'seeked', 'resize', 'pause'].forEach(name => video.removeEventListener(name, redraw));
                video.removeEventListener('play', onPlay);
                window.removeEventListener('resize', redraw);
                resizeObserver?.disconnect();
                host.classList.remove('video-enhance-on');
                gl?.getExtension('WEBGL_lose_context')?.loseContext();
                canvas.remove();
            }
        };
    }

    window.VideoEnhance = { create, isSupported, readMode, writeMode, MODES, logic: { contentRect, outputSize, computeLevels, blendLevels } };
})();
