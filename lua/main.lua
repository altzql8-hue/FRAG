require "import"

import "android.app.*"
import "android.os.*"
import "android.widget.*"
import "android.view.*"
import "android.graphics.*"
import "android.graphics.drawable.GradientDrawable"
import "android.graphics.drawable.ColorDrawable"
import "android.provider.Settings"
import "android.content.Intent"
import "android.net.Uri"
import "android.speech.tts.TextToSpeech"
import "android.media.MediaPlayer"
import "android.text.InputType"
import "android.view.animation.AlphaAnimation"
import "android.view.animation.Animation"
import "android.view.animation.ScaleAnimation"
import "java.util.Locale"
import "java.io.File"
import "http"
import "cjson"

-- ============================================================
-- FRAG HAX LOGIN • polished AndLua+ build
-- Authenticates through FRAG; the server preserves the existing Firebase schema.
-- Keeps your existing UI, device identifier, sounds and main2 navigation.
-- Put the bundled WAV files in: sounds/
-- ============================================================

-- ========================= CONFIG ============================
local APP_NAME = "FRAG HAX"
-- Configure your deployed FRAG HTTPS origin; no secret belongs in this client.
local API_BASE = "https://your-frag-domain.example"
local CONTACT_URL = "https://t.me/Frag_Haxs"
local ENABLE_TTS = true
local ENABLE_SFX = true

local COLORS = {
  bg = "#05070B",
  panel = "#0C1118",
  panel2 = "#111923",
  field = "#0A1017",
  cyan = "#28D7FF",
  cyanSoft = "#163441",
  text = "#F8FAFC",
  muted = "#7B8794",
  green = "#4ADE80",
  red = "#F87171",
  orange = "#F59E0B",
  border = "#1F2A37"
}

local hwid = Settings.Secure.getString(
activity.getContentResolver(),
Settings.Secure.ANDROID_ID
) or "unknown-device"

local wrongAttempts = 0
local lockDuration = 5
local isLocked = false
local requestInFlight = false
local tts = nil
local activePlayers = {}

-- ========================= HELPERS ============================
local function color(hex)
  return Color.parseColor(hex)
end

local function trim(value)
  value = tostring(value or "")
  return value:match("^%s*(.-)%s*$") or ""
end


local function shortDeviceId(value)
  value = tostring(value or "")
  if #value <= 8 then return value end
  return "••••" .. value:sub(-8)
end

local function maskKey(value)
  value = tostring(value or "")
  if #value <= 8 then return value end
  return value:sub(1, 4) .. string.rep("•", math.min(8, #value - 8)) .. value:sub(-4)
end

local function makeDrawable(fill, stroke, radius, strokeWidth)
  local gd = GradientDrawable()
  gd.setColor(color(fill))
  gd.setCornerRadius(tonumber(radius or 18))
  if stroke then
    gd.setStroke(tonumber(strokeWidth or 1), color(stroke))
  end
  return gd
end

local function setRounded(view, fill, stroke, radius, strokeWidth)
  if view then
    view.setBackground(makeDrawable(fill, stroke, radius, strokeWidth))
  end
end

local function fadeIn(view, duration)
  if not view then return end
  local anim = AlphaAnimation(0.0, 1.0)
  anim.setDuration(duration or 450)
  view.startAnimation(anim)
end

local function pulse(view)
  if not view then return end
  local anim = ScaleAnimation(
  1.0, 0.97,
  1.0, 0.97,
  Animation.RELATIVE_TO_SELF, 0.5,
  Animation.RELATIVE_TO_SELF, 0.5
  )
  anim.setDuration(90)
  anim.setRepeatCount(1)
  anim.setRepeatMode(Animation.REVERSE)
  view.startAnimation(anim)
end

local function openUrl(url)
  pcall(function()
    activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
  end)
end

-- ========================= SOUND ==============================
local function removePlayer(player)
  for i = #activePlayers, 1, -1 do
    if activePlayers[i] == player then
      table.remove(activePlayers, i)
      break
    end
  end
end

local function playSfx(name)
  if not ENABLE_SFX then return end

  pcall(function()
    local soundPath = activity.getLuaDir("sounds") .. "/" .. tostring(name) .. ".wav"
    local file = File(soundPath)
    if not file.exists() then return end

    local player = MediaPlayer()
    table.insert(activePlayers, player)
    player.setDataSource(soundPath)
    player.setOnCompletionListener(MediaPlayer.OnCompletionListener{
      onCompletion = function(mp)
        removePlayer(mp)
        pcall(function() mp.release() end)
      end
    })
    player.prepare()
    player.start()
  end)
end

-- ========================= TTS ================================
if ENABLE_TTS then
  pcall(function()
    tts = TextToSpeech(activity, TextToSpeech.OnInitListener{
      onInit = function(status)
        if status == TextToSpeech.SUCCESS and tts then
          tts.setLanguage(Locale.US)
          tts.setSpeechRate(1.02)
        end
      end
    })
  end)
end

local function speak(text)
  if not ENABLE_TTS or not tts then return end
  pcall(function()
    tts.speak(tostring(text), TextToSpeech.QUEUE_FLUSH, nil, "frag_hax_tts")
  end)
end

-- ========================= TOAST ===============================
local function customToast(msg, accent)
  activity.runOnUiThread(function()
    local env = {}
    local toastView = loadlayout({
      LinearLayout;
      orientation="horizontal";
      gravity="center_vertical";
      paddingLeft="16dp";
      paddingRight="16dp";
      paddingTop="11dp";
      paddingBottom="11dp";
      {
        TextView;
        id="toastDot";
        text="●";
        textSize="13sp";
        textColor=accent or COLORS.cyan;
        layout_marginRight="10dp";
      };
      {
        TextView;
        id="toastText";
        text=tostring(msg or APP_NAME);
        textColor=COLORS.text;
        textSize="13sp";
        Typeface=Typeface.DEFAULT_BOLD;
      };
    }, env)

    setRounded(toastView, COLORS.panel2, COLORS.border, 30, 1)
    local toast = Toast(activity)
    toast.setDuration(Toast.LENGTH_SHORT)
    toast.setView(toastView)
    toast.show()
  end)
end

local function logMsg(msg, accent)
  activity.runOnUiThread(function()
    if statusText then
      statusText.setText(string.upper(tostring(msg or "")))
      statusText.setTextColor(color(accent or COLORS.cyan))
    end
    if statusDot then
      statusDot.setTextColor(color(accent or COLORS.cyan))
    end
  end)
end

local function setLoginButton(enabled, text)
  activity.runOnUiThread(function()
    if not loginBtn then return end
    loginBtn.setEnabled(enabled)
    loginBtn.setAlpha(enabled and 1.0 or 0.5)
    loginBtn.setText(text or (enabled and "AUTHENTICATE" or "PLEASE WAIT…"))
  end)
end

local function reportError(status, toastText, dialogType)
  requestInFlight = false
  setLoginButton(true)
  logMsg(status, COLORS.red)
  customToast(toastText or status, COLORS.red)
  playSfx("error")
  speak(toastText or status)

  if dialogType == "banned" then
    showBannedDialog()
   elseif dialogType == "frozen" then
    showFrozenDialog()
   elseif dialogType == "expired" then
    showExpiredDialog()
  end

  wrongAttempts = wrongAttempts + 1
  if wrongAttempts >= 3 then
    wrongAttempts = 0
    lockLoginSystem()
  end
end

-- ========================= ASYNC REST WRITE ====================
-- Uses a real AndLua background task for blocking HttpURLConnection writes.
local function authenticateRemote(key, device, callback)
  local worker = activity.newTask(
  function(reqUrl, payload)
    require "import"
    import "java.net.URL"
    import "java.io.OutputStreamWriter"
    import "java.io.BufferedReader"
    import "java.io.InputStreamReader"
    local conn = nil
    local ok, code, body = pcall(function()
      conn = URL(reqUrl).openConnection()
      conn.setRequestMethod("POST")
      conn.setConnectTimeout(10000)
      conn.setReadTimeout(15000)
      conn.setDoOutput(true)
      conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
      local writer = OutputStreamWriter(conn.getOutputStream(), "UTF-8")
      writer.write(payload)
      writer.flush()
      writer.close()
      local status = conn.getResponseCode()
      local stream = status >= 400 and conn.getErrorStream() or conn.getInputStream()
      local parts = {}
      if stream then
        local reader = BufferedReader(InputStreamReader(stream, "UTF-8"))
        local line = reader.readLine()
        local size = 0
        while line do
          size = size + #tostring(line)
          if size > 65536 then error("Response too large") end
          parts[#parts + 1] = tostring(line)
          line = reader.readLine()
        end
        reader.close()
      end
      return status, table.concat(parts)
    end)
    if conn then pcall(function() conn.disconnect() end) end
    if not ok then return -1, "" end
    return tonumber(code) or -1, tostring(body or "")
  end,
  nil,
  function(code, body)
    callback(tonumber(code) or -1, tostring(body or ""))
  end
  )
  worker.execute{API_BASE .. "/api/license/authenticate", cjson.encode({key=key, hwid=device})}
end

-- ========================= LOCKOUT =============================
function lockLoginSystem()
  if isLocked then return end

  isLocked = true
  requestInFlight = false
  setLoginButton(false, "TEMPORARILY LOCKED")
  playSfx("locked")

  local timeLeft = lockDuration
  local function countdown()
    if timeLeft > 0 then
      logMsg("LOCKED • TRY AGAIN IN " .. timeLeft .. "S", COLORS.red)
      timeLeft = timeLeft - 1
      task(1000, countdown)
     else
      isLocked = false
      setLoginButton(true)
      logMsg("SYSTEM READY", COLORS.muted)
      customToast("LOGIN UNLOCKED", COLORS.cyan)
      lockDuration = math.min(lockDuration + 5, 30)
    end
  end

  countdown()
end

-- ========================= DIALOGS =============================
local function showStateDialog(title, message, accent, contactText)
  playSfx("error")

  local env = {}
  local dl = {
    LinearLayout;
    layout_width="fill";
    orientation="vertical";
    padding="24dp";
    {
      TextView;
      text=title;
      textColor=accent;
      textSize="24sp";
      textStyle="bold";
      layout_gravity="center";
      gravity="center";
      layout_marginBottom="10dp";
    };
    {
      TextView;
      text=message;
      textColor="#CBD5E1";
      textSize="14sp";
      layout_gravity="center";
      gravity="center";
      layout_marginBottom="22dp";
    };
    {
      LinearLayout;
      layout_width="fill";
      orientation="horizontal";
      gravity="center";
      {
        Button;
        id="continueBtn";
        text="CLOSE";
        layout_width="0dp";
        layout_weight=1;
        layout_marginRight="6dp";
        textColor=COLORS.text;
        textStyle="bold";
      };
      {
        Button;
        id="contactBtn";
        text=contactText or "CONTACT";
        layout_width="0dp";
        layout_weight=1;
        layout_marginLeft="6dp";
        textColor="#020617";
        textStyle="bold";
      };
    };
  }

  local dialogView = loadlayout(dl, env)
  setRounded(dialogView, COLORS.panel, accent, 24, 3)
  setRounded(env.continueBtn, COLORS.panel2, COLORS.border, 16, 1)
  setRounded(env.contactBtn, accent, accent, 16, 1)

  local dialog = AlertDialog.Builder(activity)
  .setView(dialogView)
  .setCancelable(false)
  .show()

  pcall(function()
    dialog.getWindow().setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
  end)

  env.continueBtn.onClick = function()
    playSfx("tap")
    dialog.dismiss()
  end

  env.contactBtn.onClick = function()
    playSfx("tap")
    dialog.dismiss()
    openUrl(CONTACT_URL)
  end
end

function showBannedDialog()
  showStateDialog(
  "KEY BANNED",
  "This license has been disabled.\nIf you believe this is a mistake, contact the owner.",
  COLORS.red
  )
end

function showFrozenDialog()
  showStateDialog(
  "KEY FROZEN",
  "This license is temporarily frozen.\nContact the owner if you need it reviewed.",
  COLORS.cyan
  )
end

function showExpiredDialog()
  showStateDialog(
  "KEY EXPIRED",
  "This license has reached its expiry date.\nContact the owner to renew or replace it.",
  COLORS.orange
  )
end

function showSuccessDialog(key, rank, expiry, devices, maxDev, usage)
  playSfx("success")

  local env = {}
  local dl = {
    LinearLayout;
    layout_width="fill";
    orientation="vertical";
    padding="24dp";
    {
      TextView;
      text="✓";
      textColor=COLORS.green;
      textSize="38sp";
      textStyle="bold";
      gravity="center";
      layout_gravity="center";
    };
    {
      TextView;
      text="ACCESS GRANTED";
      textColor=COLORS.green;
      textSize="22sp";
      textStyle="bold";
      gravity="center";
      layout_gravity="center";
      layout_marginBottom="18dp";
    };
    {
      TextView;
      text="LICENSE   " .. maskKey(key);
      textColor=COLORS.text;
      textSize="13sp";
      layout_marginBottom="7dp";
    };
    {
      TextView;
      text="RANK      " .. tostring(rank);
      textColor=COLORS.cyan;
      textSize="13sp";
      layout_marginBottom="7dp";
    };
    {
      TextView;
      text="EXPIRY    " .. tostring(expiry);
      textColor="#CBD5E1";
      textSize="13sp";
      layout_marginBottom="7dp";
    };
    {
      TextView;
      text="DEVICES   " .. tostring(devices) .. " / " .. tostring(maxDev);
      textColor="#CBD5E1";
      textSize="13sp";
      layout_marginBottom="7dp";
    };
    {
      TextView;
      text="SESSIONS  " .. tostring(usage);
      textColor=COLORS.orange;
      textSize="13sp";
      textStyle="bold";
    };
    {
      Button;
      id="enterHubBtn";
      text="ENTER HUB";
      layout_width="fill";
      layout_height="54dp";
      layout_marginTop="22dp";
      textColor="#020617";
      textStyle="bold";
    };
  }

  local dialogView = loadlayout(dl, env)
  setRounded(dialogView, COLORS.panel, COLORS.green, 24, 3)
  setRounded(env.enterHubBtn, COLORS.green, COLORS.green, 16, 1)

  local dialog = AlertDialog.Builder(activity)
  .setView(dialogView)
  .setCancelable(false)
  .show()

  pcall(function()
    dialog.getWindow().setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
  end)

  env.enterHubBtn.onClick = function()
    pulse(env.enterHubBtn)
    playSfx("tap")
    dialog.dismiss()
    activity.newActivity("main2")
    activity.finish()
  end
end

-- ========================= LAYOUTS =============================
splash_layout = {
  LinearLayout;
  id="splashRoot";
  layout_width="fill";
  layout_height="fill";
  backgroundColor=COLORS.bg;
  gravity="center";
  orientation="vertical";
  padding="34dp";
  {
    TextView;
    id="splashLogo";
    text="FH";
    textSize="30sp";
    textColor=COLORS.cyan;
    textStyle="bold";
    gravity="center";
    layout_width="86dp";
    layout_height="86dp";
    Typeface=Typeface.MONOSPACE;
  };
  {
    TextView;
    text="FRAG HAX";
    textSize="34sp";
    textColor=COLORS.text;
    textStyle="bold";
    Typeface=Typeface.MONOSPACE;
    layout_marginTop="20dp";
  };
  {
    TextView;
    text="SECURE ACCESS GATEWAY";
    textSize="11sp";
    textColor=COLORS.muted;
    layout_marginTop="6dp";
    letterSpacing=0.18;
  };
  {
    ProgressBar;
    id="splashProgress";
    layout_width="32dp";
    layout_height="32dp";
    layout_marginTop="34dp";
  };
  {
    TextView;
    text="INITIALIZING…";
    textSize="11sp";
    textColor=COLORS.muted;
    layout_marginTop="12dp";
  };
}

login_layout = {
  ScrollView;
  id="rootScroll";
  layout_width="fill";
  layout_height="fill";
  backgroundColor=COLORS.bg;
  fillViewport=true;
  {
    LinearLayout;
    id="loginRoot";
    orientation="vertical";
    layout_width="fill";
    layout_height="wrap";
    gravity="center_horizontal";
    paddingLeft="24dp";
    paddingRight="24dp";
    paddingTop="36dp";
    paddingBottom="32dp";

    {
      TextView;
      id="brandMark";
      text="FH";
      textSize="24sp";
      textColor=COLORS.cyan;
      textStyle="bold";
      gravity="center";
      layout_width="72dp";
      layout_height="72dp";
      Typeface=Typeface.MONOSPACE;
    };
    {
      TextView;
      text="FRAG HAX";
      textSize="31sp";
      textColor=COLORS.text;
      textStyle="bold";
      Typeface=Typeface.MONOSPACE;
      layout_marginTop="18dp";
    };
    {
      TextView;
      text="LICENSE AUTHENTICATION";
      textSize="11sp";
      textColor=COLORS.muted;
      letterSpacing=0.14;
      layout_marginTop="5dp";
      layout_marginBottom="28dp";
    };

    {
      LinearLayout;
      id="loginPanel";
      orientation="vertical";
      layout_width="fill";
      layout_height="wrap";
      padding="20dp";

      {
        TextView;
        text="LICENSE KEY";
        textSize="11sp";
        textColor=COLORS.muted;
        textStyle="bold";
        layout_marginBottom="8dp";
      };
      {
        LinearLayout;
        id="keyFieldShell";
        layout_width="fill";
        layout_height="58dp";
        gravity="center_vertical";
        paddingLeft="16dp";
        paddingRight="8dp";
        {
          EditText;
          id="keyInput";
          layout_width="0dp";
          layout_weight=1;
          layout_height="fill";
          hint="Enter your license key";
          textColor=COLORS.text;
          hintTextColor="#465466";
          backgroundColor="#00000000";
          textSize="14sp";
          singleLine=true;
          paddingLeft="0dp";
          paddingRight="8dp";
        };
        {
          TextView;
          id="clearKeyBtn";
          text="×";
          textSize="25sp";
          textColor=COLORS.muted;
          gravity="center";
          layout_width="42dp";
          layout_height="42dp";
        };
      };

      {
        CheckBox;
        id="rememberCb";
        text="Remember this key on this device";
        textColor="#CBD5E1";
        textSize="13sp";
        layout_marginTop="10dp";
      };

      {
        Button;
        id="loginBtn";
        text="AUTHENTICATE";
        layout_width="fill";
        layout_height="56dp";
        layout_marginTop="18dp";
        textColor="#020617";
        textStyle="bold";
        textSize="14sp";
      };

      {
        LinearLayout;
        id="statusShell";
        orientation="horizontal";
        gravity="center_vertical";
        layout_width="fill";
        layout_height="46dp";
        layout_marginTop="14dp";
        paddingLeft="14dp";
        paddingRight="14dp";
        {
          TextView;
          id="statusDot";
          text="●";
          textColor=COLORS.muted;
          textSize="11sp";
          layout_marginRight="9dp";
        };
        {
          TextView;
          id="statusText";
          text="SYSTEM READY";
          textSize="11sp";
          textColor=COLORS.muted;
          textStyle="bold";
          layout_weight=1;
        };
      };
    };

    {
      TextView;
      id="buyKeyText";
      text="DON'T HAVE A KEY?  GET ACCESS →";
      layout_marginTop="20dp";
      textColor=COLORS.cyan;
      textSize="12sp";
      textStyle="bold";
      padding="10dp";
    };
    {
      TextView;
      id="deviceText";
      text="DEVICE  " .. shortDeviceId(hwid);
      textColor="#48576A";
      textSize="10sp";
      Typeface=Typeface.MONOSPACE;
      layout_marginTop="8dp";
    };
  };
}

-- ========================= LOGIN LOGIC =========================
function finalizeLogin(key, data, currentDeviceCount)
  requestInFlight = false
  wrongAttempts = 0
  setLoginButton(true)
  logMsg("AUTHENTICATION SUCCESSFUL", COLORS.green)
  customToast("AUTHENTICATION SUCCESSFUL", COLORS.green)
  speak("Authentication successful")

  local sp = activity.getSharedPreferences("FragHaxPrefs", 0)
  local editor = sp.edit()

  if rememberCb and rememberCb.Checked then
    editor.putString("saved_key", key)
    editor.putBoolean("remember_me", true)
   else
    editor.remove("saved_key")
    editor.putBoolean("remember_me", false)
  end
  editor.apply()

  -- The server has already atomically registered the device and counted usage.
  local newUsage = tonumber(data.usageCount) or 0

  local expiryText = "Lifetime"
  local expiresAt = tonumber(data.expiresAt) or 0
  if expiresAt > 0 then
    expiryText = os.date("%Y-%m-%d %H:%M", math.floor(expiresAt / 1000))
  end

  showSuccessDialog(
  key,
  string.upper(tostring(data.type or "PREMIUM")),
  expiryText,
  currentDeviceCount,
  tonumber(data.maxDevices) or 1,
  newUsage
  )
end

local function validateKeyFormat(key)
  if key == "" then
    return false, "KEY REQUIRED"
  end

  if #key < 3 or #key > 120 then
    return false, "INVALID KEY FORMAT"
  end

  -- Firebase RTDB node names cannot contain these characters.
  if key:find("[%.#$%[%]/]") then
    return false, "INVALID KEY FORMAT"
  end

  return true
end

local function beginLogin()
  if isLocked or requestInFlight then return end

  local key = trim(keyInput and keyInput.Text or "")
  local valid, reason = validateKeyFormat(key)

  if not valid then
    logMsg("ERROR • " .. reason, COLORS.red)
    customToast(reason, COLORS.red)
    playSfx("error")
    speak(reason)
    return
  end

  requestInFlight = true
  setLoginButton(false, "VERIFYING…")
  logMsg("CONTACTING SERVER…", COLORS.cyan)
  playSfx("tap")

  if API_BASE == "https://your-frag-domain.example" or not API_BASE:match("^https://") then
    requestInFlight = false
    setLoginButton(true)
    logMsg("CONFIGURE THE FRAG HTTPS SERVER URL", COLORS.red)
    return
  end

  authenticateRemote(key, tostring(hwid), function(code, content)
    local decoded, response = pcall(cjson.decode, content)
    if not decoded or type(response) ~= "table" then
      requestInFlight = false
      setLoginButton(true)
      logMsg("CONNECTION ERROR • " .. tostring(code), COLORS.red)
      customToast("SERVER UNAVAILABLE — TRY AGAIN", COLORS.red)
      return
    end
    if code ~= 200 or response.success ~= true then
      local err = type(response.error) == "table" and response.error or {}
      local reason = tostring(err.code or "ACCESS_DENIED"):lower()
      local message = tostring(err.message or "Access denied")
      if code == 429 or code >= 500 then
        requestInFlight = false
        setLoginButton(true)
        logMsg(message, COLORS.orange)
        customToast(message, COLORS.orange)
      else
        reportError(message, message, reason)
      end
      return
    end
    local data = response.data
    if type(data) ~= "table" or data.status ~= "active" then
      requestInFlight = false
      setLoginButton(true)
      logMsg("INVALID SERVER RESPONSE", COLORS.red)
      return
    end
    finalizeLogin(key, data, tonumber(data.devices) or 0)
  end)
end

function setupLoginLogic()
  setRounded(brandMark, COLORS.panel2, COLORS.cyanSoft, 72, 2)
  setRounded(loginPanel, COLORS.panel, COLORS.border, 24, 1)
  setRounded(keyFieldShell, COLORS.field, COLORS.border, 16, 1)
  setRounded(loginBtn, COLORS.cyan, COLORS.cyan, 16, 1)
  setRounded(statusShell, COLORS.field, COLORS.border, 14, 1)

  keyInput.setSingleLine(true)
  keyInput.setInputType(InputType.TYPE_CLASS_TEXT)
  keyInput.setImeOptions(6) -- EditorInfo.IME_ACTION_DONE

  buyKeyText.onClick = function()
    playSfx("tap")
    openUrl(CONTACT_URL)
  end

  clearKeyBtn.onClick = function()
    playSfx("tap")
    keyInput.setText("")
    keyInput.requestFocus()
  end

  loginBtn.onClick = function()
    pulse(loginBtn)
    beginLogin()
  end

  keyInput.setOnEditorActionListener(TextView.OnEditorActionListener{
    onEditorAction = function(_, actionId, _)
      if actionId == 6 then
        beginLogin()
        return true
      end
      return false
    end
  })
end

-- ========================= STARTUP =============================
local splashView = loadlayout(splash_layout)
activity.setContentView(splashView)
setRounded(splashLogo, COLORS.panel2, COLORS.cyan, 86, 2)
fadeIn(splashView, 400)
playSfx("startup")

task(1800, function()
  local view = loadlayout(login_layout)
  activity.setContentView(view)
  setupLoginLogic()

  local sp = activity.getSharedPreferences("FragHaxPrefs", 0)
  if sp.getBoolean("remember_me", false) then
    keyInput.setText(sp.getString("saved_key", ""))
    rememberCb.Checked = true
  end

  fadeIn(view, 500)
  customToast("WELCOME TO FRAG HAX", COLORS.cyan)
  speak("Welcome to Frag Hax login")
end)

-- ========================= CLEANUP =============================
function onDestroy()
  pcall(function()
    if tts then
      tts.stop()
      tts.shutdown()
      tts = nil
    end
  end)

  for i = #activePlayers, 1, -1 do
    local player = activePlayers[i]
    pcall(function()
      player.stop()
      player.release()
    end)
    activePlayers[i] = nil
  end
end
