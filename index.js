import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const EXT_NAME = "桌宠";

const DEFAULT_ZONE_PHRASES = {
    head: ["摸摸头最舒服了~", "呜...被摸头有点害羞", "再摸一下嘛", "喜欢这样"],
    body: ["咕噜咕噜~", "别挠我痒痒的地方！", "今天感觉不错呢", "抱一下也不是不可以"],
    tail: ["喂！那里不能乱碰！", "呀！吓我一跳", "尾巴是禁区哦...", "讨厌啦"],
};

const DEFAULT_SETTINGS = {
    enabled: true,
    imageData: null,
    imageDataTouch: null,
    size: 120,
    posX: null,
    posY: null,
    dragBoundaryPadding: 8,
    reactionMode: "fixed", // 'fixed' | 'mainApi' | 'customApi'
    customApi: {
        baseUrl: "",   // 例如 https://your-proxy.com/v1/chat/completions
        apiKey: "",
        model: "",
    },
    zonePhrases: structuredClone(DEFAULT_ZONE_PHRASES),
};

const DEFAULT_SPRITE =
    "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <ellipse cx="100" cy="140" rx="62" ry="48" fill="#c99a4f"/>
  <circle cx="100" cy="80" r="52" fill="#e0b877"/>
  <polygon points="55,55 70,15 88,60" fill="#e0b877"/>
  <polygon points="145,55 130,15 112,60" fill="#e0b877"/>
  <polygon points="60,52 70,28 82,58" fill="#c99a4f"/>
  <polygon points="140,52 130,28 118,58" fill="#c99a4f"/>
  <circle cx="80" cy="82" r="7" fill="#4a3c2c"/>
  <circle cx="120" cy="82" r="7" fill="#4a3c2c"/>
  <ellipse cx="100" cy="98" rx="6" ry="4" fill="#4a3c2c"/>
  <path d="M90,106 Q100,114 110,106" stroke="#4a3c2c" stroke-width="3" fill="none" stroke-linecap="round"/>
  <line x1="40" y1="90" x2="70" y2="94" stroke="#4a3c2c" stroke-width="2"/>
  <line x1="40" y1="100" x2="70" y2="100" stroke="#4a3c2c" stroke-width="2"/>
  <line x1="160" y1="90" x2="130" y2="94" stroke="#4a3c2c" stroke-width="2"/>
  <line x1="160" y1="100" x2="130" y2="100" stroke="#4a3c2c" stroke-width="2"/>
</svg>`);

const ZONE_LABEL_CN = { head: "头顶", body: "身上", tail: "尾巴/敏感处" };

function loadSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    for (const key in DEFAULT_SETTINGS) {
        if (extension_settings[EXT_NAME][key] === undefined) {
            extension_settings[EXT_NAME][key] = structuredClone(DEFAULT_SETTINGS[key]);
        }
    }
    // 旧版本(aiEnabled布尔值)迁移到新的reactionMode
    if (extension_settings[EXT_NAME].aiEnabled === true && !extension_settings[EXT_NAME]._migratedReactionMode) {
        extension_settings[EXT_NAME].reactionMode = "mainApi";
    }
    extension_settings[EXT_NAME]._migratedReactionMode = true;
    if (!extension_settings[EXT_NAME].customApi) {
        extension_settings[EXT_NAME].customApi = structuredClone(DEFAULT_SETTINGS.customApi);
    }

    if (!extension_settings[EXT_NAME].zonePhrases) {
        extension_settings[EXT_NAME].zonePhrases = structuredClone(DEFAULT_ZONE_PHRASES);
    }
    for (const zone of ["head", "body", "tail"]) {
        if (!Array.isArray(extension_settings[EXT_NAME].zonePhrases[zone]) || extension_settings[EXT_NAME].zonePhrases[zone].length === 0) {
            extension_settings[EXT_NAME].zonePhrases[zone] = structuredClone(DEFAULT_ZONE_PHRASES[zone]);
        }
    }
    return extension_settings[EXT_NAME];
}

function persist() {
    saveSettingsDebounced();
}

let settings;
let $container, $sprite, $bubble, $menu, $fileInput, $fileInputTouch;
let bubbleTimer = null;
let touchImgTimer = null;
let isGenerating = false;

function clampPosition(x, y, size) {
    const pad = settings.dragBoundaryPadding;
    const maxX = window.innerWidth - size - pad;
    const maxY = window.innerHeight - size - pad;
    return {
        x: Math.min(Math.max(x, pad), Math.max(maxX, pad)),
        y: Math.min(Math.max(y, pad), Math.max(maxY, pad)),
    };
}

function applyPosition() {
    const size = settings.size;
    let x = settings.posX;
    let y = settings.posY;
    if (x === null || y === null) {
        x = window.innerWidth - size - 24;
        y = window.innerHeight - size - 24;
    }
    const clamped = clampPosition(x, y, size);
    $container.css({ left: clamped.x + "px", top: clamped.y + "px", width: size + "px" });
}

function idleSprite() {
    return settings.imageData || DEFAULT_SPRITE;
}

function touchSprite() {
    return settings.imageDataTouch || settings.imageData || DEFAULT_SPRITE;
}

function applySprite() {
    $sprite.attr("src", idleSprite());
}

function showTouchSprite(durationMs) {
    clearTimeout(touchImgTimer);
    $sprite.attr("src", touchSprite());
    if (durationMs) {
        touchImgTimer = setTimeout(() => $sprite.attr("src", idleSprite()), durationMs);
    }
}

function applyVisibility() {
    $container.toggleClass("dp-hidden", !settings.enabled);
}

function showBubble(text) {
    clearTimeout(bubbleTimer);
    $bubble.text(text).addClass("dp-show");
    bubbleTimer = setTimeout(() => $bubble.removeClass("dp-show"), 2400);
}

function bounceZone(zone) {
    $container.removeClass("dp-bounce-head dp-bounce-body dp-bounce-tail");
    void $container[0].offsetWidth;
    $container.addClass("dp-bounce-" + zone);
    setTimeout(() => $container.removeClass("dp-bounce-" + zone), 500);
}

function randomZonePhrase(zone) {
    const list = settings.zonePhrases[zone] && settings.zonePhrases[zone].length
        ? settings.zonePhrases[zone]
        : DEFAULT_ZONE_PHRASES[zone];
    return list[Math.floor(Math.random() * list.length)];
}

function getZoneFromClientY(clientY) {
    const rect = $container[0].getBoundingClientRect();
    const relY = (clientY - rect.top) / rect.height;
    if (relY < 0.38) return "head";
    if (relY < 0.72) return "body";
    return "tail";
}

function buildZonePrompt(zone) {
    const zoneCn = ZONE_LABEL_CN[zone];
    let prompt = `（系统提示，非正文，请勿输出任何解释或前后缀：{{user}}刚刚轻轻碰了碰你的${zoneCn}。请你以你当前扮演的角色身份，用不超过20个字的一句话做出简短反应，只输出这一句反应内容本身，不要包含引号、旁白、动作描写或任何解释。）`;
    try {
        const ctx = getContext();
        if (ctx && typeof ctx.substituteParams === "function") {
            prompt = ctx.substituteParams(prompt);
        }
    } catch (err) { /* 忽略，用原文 */ }
    return prompt;
}

// 方式一：走酒馆当前主线路（跟聊天共用额度）
async function generateMainApiReaction(zone) {
    try {
        const ctx = getContext();
        if (!ctx || typeof ctx.generateQuietPrompt !== "function") return null;
        const prompt = buildZonePrompt(zone);
        const result = await ctx.generateQuietPrompt({ quietPrompt: prompt });
        if (typeof result === "string" && result.trim()) {
            return result.trim().replace(/^["“]|["”]$/g, "").slice(0, 60);
        }
        return null;
    } catch (err) {
        console.warn("[桌宠] 主线路生成失败，改用固定台词：", err);
        return null;
    }
}

// 方式二：走独立配置的第三方API（跟主线路完全分开，OpenAI兼容格式）
async function generateCustomApiReaction(zone) {
    const cfg = settings.customApi;
    if (!cfg || !cfg.baseUrl || !cfg.model) return null;
    try {
        const prompt = buildZonePrompt(zone);
        const res = await fetch(cfg.baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(cfg.apiKey ? { "Authorization": "Bearer " + cfg.apiKey } : {}),
            },
            body: JSON.stringify({
                model: cfg.model,
                messages: [{ role: "user", content: prompt }],
                max_tokens: 60,
                temperature: 0.9,
            }),
        });
        if (!res.ok) {
            console.warn("[桌宠] 独立API请求失败：", res.status, await res.text().catch(() => ""));
            return null;
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content
            || data?.choices?.[0]?.text
            || data?.content?.[0]?.text
            || null;
        if (typeof text === "string" && text.trim()) {
            return text.trim().replace(/^["“]|["”]$/g, "").slice(0, 60);
        }
        return null;
    } catch (err) {
        console.warn("[桌宠] 独立API调用出错，改用固定台词：", err);
        return null;
    }
}

async function handlePet(clientY) {
    const zone = getZoneFromClientY(clientY);
    bounceZone(zone);
    showTouchSprite(1200);

    const mode = settings.reactionMode || "fixed";

    if (mode === "fixed") {
        showBubble(randomZonePhrase(zone));
        return;
    }

    if (isGenerating) return; // 避免连续点击并发请求
    isGenerating = true;
    showBubble("...");

    let aiText = null;
    if (mode === "mainApi") {
        aiText = await generateMainApiReaction(zone);
    } else if (mode === "customApi") {
        aiText = await generateCustomApiReaction(zone);
    }

    isGenerating = false;
    showBubble(aiText || randomZonePhrase(zone));
}

function openMenu(clientX, clientY) {
    const menuWidth = 170;
    const menuHeight = 180;
    let x = clientX;
    let y = clientY;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
    $menu.css({ left: x + "px", top: y + "px" }).addClass("dp-open");
}

function closeMenu() {
    $menu.removeClass("dp-open");
}

function setupDrag() {
    let dragging = false;
    let startX = 0, startY = 0;
    let originLeft = 0, originTop = 0;
    let moved = false;
    const CLICK_THRESHOLD = 6;

    $container.on("pointerdown", function (e) {
        if (e.button === 2) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = $container[0].getBoundingClientRect();
        originLeft = rect.left;
        originTop = rect.top;
        $container.addClass("dp-dragging");
        try { $container[0].setPointerCapture(e.pointerId); } catch (err) {}
        closeMenu();
    });

    $container.on("pointermove", function (e) {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD)) {
            moved = true;
            showTouchSprite(0);
        }
        const clamped = clampPosition(originLeft + dx, originTop + dy, settings.size);
        $container.css({ left: clamped.x + "px", top: clamped.y + "px" });
    });

    function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        $container.removeClass("dp-dragging");
        const rect = $container[0].getBoundingClientRect();
        settings.posX = rect.left;
        settings.posY = rect.top;
        persist();

        if (!moved) {
            handlePet(e.clientY);
        } else {
            clearTimeout(touchImgTimer);
            touchImgTimer = setTimeout(() => $sprite.attr("src", idleSprite()), 300);
        }
    }

    $container.on("pointerup", endDrag);
    $container.on("pointercancel", endDrag);

    window.addEventListener("resize", () => {
        if (settings.posX !== null) {
            const clamped = clampPosition(settings.posX, settings.posY, settings.size);
            settings.posX = clamped.x;
            settings.posY = clamped.y;
            applyPosition();
        }
    });
}

function setupMenu() {
    $container.on("contextmenu", function (e) {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
    });

    let longPressTimer = null;
    $container.on("pointerdown", function (e) {
        longPressTimer = setTimeout(() => openMenu(e.clientX, e.clientY), 600);
    });
    $container.on("pointerup pointercancel pointermove", function () {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });

    $(document).on("pointerdown", function (e) {
        if (!$(e.target).closest("#dp-menu, #dp-container").length) closeMenu();
    });

    $menu.on("click", ".dp-menu-item", function () {
        const action = $(this).data("action");
        closeMenu();
        if (action === "change-image") {
            $fileInput.trigger("click");
        } else if (action === "change-touch-image") {
            $fileInputTouch.trigger("click");
        } else if (action === "reset-pos") {
            settings.posX = null;
            settings.posY = null;
            persist();
            applyPosition();
        } else if (action === "hide") {
            settings.enabled = false;
            persist();
            applyVisibility();
        }
    });
}

function setupFileInputs() {
    $fileInput.on("change", function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file || !file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = function (ev) {
            settings.imageData = ev.target.result;
            persist();
            applySprite();
            const $p = $("#dp-settings-preview");
            if ($p.length) $p.attr("src", settings.imageData);
        };
        reader.readAsDataURL(file);
        $fileInput.val("");
    });

    $fileInputTouch.on("change", function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file || !file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = function (ev) {
            settings.imageDataTouch = ev.target.result;
            persist();
            const $p = $("#dp-settings-preview-touch");
            if ($p.length) $p.attr("src", settings.imageDataTouch);
        };
        reader.readAsDataURL(file);
        $fileInputTouch.val("");
    });
}

function buildPetDOM() {
    $container = $(`
        <div id="dp-container">
            <div id="dp-bubble"></div>
            <img id="dp-sprite" src="" alt="桌宠" draggable="false">
        </div>
    `);
    $menu = $(`
        <div id="dp-menu">
            <div class="dp-menu-item" data-action="change-image"><i class="fa-solid fa-image"></i> 更换静止图</div>
            <div class="dp-menu-item" data-action="change-touch-image"><i class="fa-solid fa-hand-pointer"></i> 更换互动图</div>
            <div class="dp-menu-item" data-action="reset-pos"><i class="fa-solid fa-arrows-to-dot"></i> 回到默认位置</div>
            <div class="dp-menu-item" data-action="hide"><i class="fa-solid fa-eye-slash"></i> 隐藏桌宠</div>
        </div>
    `);
    $fileInput = $(`<input type="file" id="dp-file-input" accept="image/*">`);
    $fileInputTouch = $(`<input type="file" id="dp-file-input-touch" accept="image/*">`);

    $("body").append($container).append($menu).append($fileInput).append($fileInputTouch);

    $sprite = $container.find("#dp-sprite");
    $bubble = $container.find("#dp-bubble");
}

function zonesToTextarea(zone) {
    return (settings.zonePhrases[zone] || []).join("\n");
}

function textareaToZones(text) {
    return text.split("\n").map(s => s.trim()).filter(Boolean);
}

function buildSettingsPanel() {
    const html = `
    <div class="dp-settings-block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>桌宠 Desktop Pet</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <div class="dp-settings-row">
                    <label><input type="checkbox" id="dp-enable-toggle"> 显示桌宠</label>
                </div>

                <div class="dp-settings-row">
                    <span>静止图片</span>
                    <img id="dp-settings-preview" src="" style="width:36px;height:36px;border-radius:8px;object-fit:cover;">
                    <div class="menu_button dp-settings-btn" id="dp-settings-upload">选择图片</div>
                </div>

                <div class="dp-settings-row">
                    <span>互动图片（拖动/被摸时，可选）</span>
                    <img id="dp-settings-preview-touch" src="" style="width:36px;height:36px;border-radius:8px;object-fit:cover;">
                    <div class="menu_button dp-settings-btn" id="dp-settings-upload-touch">选择图片</div>
                </div>

                <div class="dp-settings-row">
                    <span>大小</span>
                    <input type="range" id="dp-size-slider" min="60" max="240" step="4">
                    <span id="dp-size-label" style="min-width:42px;text-align:right;"></span>
                </div>

                <div class="dp-settings-row">
                    <div class="menu_button dp-settings-btn" id="dp-settings-reset-pos">回到默认位置</div>
                </div>

                <hr>

                <div class="dp-settings-row">
                    <span>反应来源</span>
                    <select id="dp-reaction-mode">
                        <option value="fixed">固定台词（不耗任何API）</option>
                        <option value="mainApi">酒馆当前主线路（跟聊天共用额度）</option>
                        <option value="customApi">独立API（自己填地址，跟主线路分开算）</option>
                    </select>
                </div>

                <div id="dp-custom-api-block" style="display:none;">
                    <div class="dp-zone-block">
                        <label>接口地址（OpenAI兼容格式，例如 https://xxx/v1/chat/completions）</label>
                        <input type="text" id="dp-api-url" style="width:100%;box-sizing:border-box;" placeholder="https://your-proxy.com/v1/chat/completions">
                        <label style="margin-top:6px;">API Key（没有就留空）</label>
                        <input type="text" id="dp-api-key" style="width:100%;box-sizing:border-box;" placeholder="sk-xxxxxxxx">
                        <label style="margin-top:6px;">模型名称</label>
                        <input type="text" id="dp-api-model" style="width:100%;box-sizing:border-box;" placeholder="gpt-4o-mini / claude-haiku-4-5 等">
                        <div class="dp-settings-row">
                            <div class="menu_button dp-settings-btn" id="dp-settings-test-api">测试连接</div>
                            <span id="dp-api-test-result" class="dp-hint"></span>
                        </div>
                        <p class="dp-hint">如果测试一直失败，可能是这个接口不允许浏览器直接跨域调用（CORS），不是所有代理站都支持这种用法，需要换一个支持浏览器直连的接口。</p>
                    </div>
                </div>

                <p class="dp-hint">下面是摸不同区域时的固定台词，"固定台词"模式下使用；用API的两种模式下，生成失败/超时时也会用这些兜底。一行一句。</p>

                <div class="dp-zone-block">
                    <label>头顶区域台词</label>
                    <textarea id="dp-zone-head"></textarea>
                </div>
                <div class="dp-zone-block">
                    <label>身体区域台词</label>
                    <textarea id="dp-zone-body"></textarea>
                </div>
                <div class="dp-zone-block">
                    <label>尾巴/敏感区域台词</label>
                    <textarea id="dp-zone-tail"></textarea>
                </div>
                <div class="dp-settings-row">
                    <div class="menu_button dp-settings-btn" id="dp-settings-save-phrases">保存台词</div>
                    <div class="menu_button dp-settings-btn" id="dp-settings-import-phrases">从文件导入台词</div>
                    <div class="menu_button dp-settings-btn" id="dp-settings-export-phrases">导出当前台词</div>
                </div>
                <input type="file" id="dp-phrases-file-input" accept="application/json" style="display:none;">

                <small class="dp-hint">拖动桌宠可以移动位置；轻点它上/中/下不同区域会有不同反应；右键（或长按）呼出菜单可更换图片 / 隐藏。</small>
            </div>
        </div>
    </div>`;

    const $panel = $(html);
    $("#extensions_settings2").append($panel);

    const $enable = $panel.find("#dp-enable-toggle");
    const $preview = $panel.find("#dp-settings-preview");
    const $previewTouch = $panel.find("#dp-settings-preview-touch");
    const $upload = $panel.find("#dp-settings-upload");
    const $uploadTouch = $panel.find("#dp-settings-upload-touch");
    const $sizeSlider = $panel.find("#dp-size-slider");
    const $sizeLabel = $panel.find("#dp-size-label");
    const $resetPos = $panel.find("#dp-settings-reset-pos");
    const $reactionMode = $panel.find("#dp-reaction-mode");
    const $customApiBlock = $panel.find("#dp-custom-api-block");
    const $apiUrl = $panel.find("#dp-api-url");
    const $apiKey = $panel.find("#dp-api-key");
    const $apiModel = $panel.find("#dp-api-model");
    const $testApi = $panel.find("#dp-settings-test-api");
    const $testResult = $panel.find("#dp-api-test-result");
    const $zoneHead = $panel.find("#dp-zone-head");
    const $zoneBody = $panel.find("#dp-zone-body");
    const $zoneTail = $panel.find("#dp-zone-tail");
    const $savePhrases = $panel.find("#dp-settings-save-phrases");
    const $importPhrases = $panel.find("#dp-settings-import-phrases");
    const $exportPhrases = $panel.find("#dp-settings-export-phrases");
    const $phrasesFileInput = $panel.find("#dp-phrases-file-input");

    $enable.prop("checked", settings.enabled);
    $preview.attr("src", settings.imageData || DEFAULT_SPRITE);
    $previewTouch.attr("src", settings.imageDataTouch || settings.imageData || DEFAULT_SPRITE);
    $sizeSlider.val(settings.size);
    $sizeLabel.text(settings.size + "px");
    $reactionMode.val(settings.reactionMode || "fixed");
    $customApiBlock.toggle(settings.reactionMode === "customApi");
    $apiUrl.val(settings.customApi.baseUrl || "");
    $apiKey.val(settings.customApi.apiKey || "");
    $apiModel.val(settings.customApi.model || "");
    $zoneHead.val(zonesToTextarea("head"));
    $zoneBody.val(zonesToTextarea("body"));
    $zoneTail.val(zonesToTextarea("tail"));

    $enable.on("change", function () {
        settings.enabled = $(this).is(":checked");
        persist();
        applyVisibility();
    });

    $upload.on("click", () => $fileInput.trigger("click"));
    $uploadTouch.on("click", () => $fileInputTouch.trigger("click"));

    $sizeSlider.on("input", function () {
        settings.size = parseInt($(this).val(), 10);
        $sizeLabel.text(settings.size + "px");
        persist();
        applyPosition();
    });

    $resetPos.on("click", function () {
        settings.posX = null;
        settings.posY = null;
        persist();
        applyPosition();
    });

    $reactionMode.on("change", function () {
        settings.reactionMode = $(this).val();
        persist();
        $customApiBlock.toggle(settings.reactionMode === "customApi");
    });

    $apiUrl.on("change", function () { settings.customApi.baseUrl = $(this).val().trim(); persist(); });
    $apiKey.on("change", function () { settings.customApi.apiKey = $(this).val().trim(); persist(); });
    $apiModel.on("change", function () { settings.customApi.model = $(this).val().trim(); persist(); });

    $testApi.on("click", async function () {
        $testResult.text("测试中...");
        // 先临时用当前输入框的值测试，即使还没点保存
        const tempCfg = {
            baseUrl: $apiUrl.val().trim(),
            apiKey: $apiKey.val().trim(),
            model: $apiModel.val().trim(),
        };
        const backup = settings.customApi;
        settings.customApi = tempCfg;
        const result = await generateCustomApiReaction("body");
        settings.customApi = backup;
        $testResult.text(result ? ("成功：" + result) : "失败，看看浏览器控制台(F12)的报错信息");
    });

    $savePhrases.on("click", function () {
        const h = textareaToZones($zoneHead.val());
        const b = textareaToZones($zoneBody.val());
        const t = textareaToZones($zoneTail.val());
        settings.zonePhrases.head = h.length ? h : structuredClone(DEFAULT_ZONE_PHRASES.head);
        settings.zonePhrases.body = b.length ? b : structuredClone(DEFAULT_ZONE_PHRASES.body);
        settings.zonePhrases.tail = t.length ? t : structuredClone(DEFAULT_ZONE_PHRASES.tail);
        persist();
        if (typeof toastr !== "undefined" && toastr.success) toastr.success("台词已保存");
    });

    $importPhrases.on("click", () => $phrasesFileInput.trigger("click"));

    $phrasesFileInput.on("change", function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (ev) {
            try {
                const data = JSON.parse(ev.target.result);
                const h = Array.isArray(data.head) ? data.head : null;
                const b = Array.isArray(data.body) ? data.body : null;
                const t = Array.isArray(data.tail) ? data.tail : null;
                if (!h && !b && !t) throw new Error("文件里没有找到 head/body/tail 数组");
                if (h) settings.zonePhrases.head = h;
                if (b) settings.zonePhrases.body = b;
                if (t) settings.zonePhrases.tail = t;
                persist();
                $zoneHead.val(zonesToTextarea("head"));
                $zoneBody.val(zonesToTextarea("body"));
                $zoneTail.val(zonesToTextarea("tail"));
                if (typeof toastr !== "undefined" && toastr.success) toastr.success("台词导入成功");
            } catch (err) {
                console.warn("[桌宠] 台词文件解析失败：", err);
                if (typeof toastr !== "undefined" && toastr.error) toastr.error("文件格式不对，需要 {head:[...], body:[...], tail:[...]} 这样的JSON");
            }
        };
        reader.readAsText(file);
        $phrasesFileInput.val("");
    });

    $exportPhrases.on("click", function () {
        const blob = new Blob([JSON.stringify(settings.zonePhrases, null, 4)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "桌宠台词.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    $fileInput.on("change", () => setTimeout(() => $preview.attr("src", settings.imageData || DEFAULT_SPRITE), 50));
    $fileInputTouch.on("change", () => setTimeout(() => $previewTouch.attr("src", settings.imageDataTouch || settings.imageData || DEFAULT_SPRITE), 50));
}

jQuery(async () => {
    settings = loadSettings();
    buildPetDOM();
    applySprite();
    applyPosition();
    applyVisibility();
    setupDrag();
    setupMenu();
    setupFileInputs();
    buildSettingsPanel();
});
