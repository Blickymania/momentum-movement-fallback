
// COMMUNITY_STATS_MANUAL_LAYOUT_V1: channel/category structure is owner-managed; no automated layout restoration. Zero-valued statistic rows remain visible.
const DEFAULT_GREETING='🤗 Welcome Home';
const GREETING_GROUPS=[["🌙 Midnight Vibe","🌌 After Hours","✨ Night Owls","🌃 Late Night","😴 Cozy Night","🌠 Starry Hello","🦉 Night Crew","🌙 Moonlight","💜 Night Hugs","🌌 Night Chat","💫 Midnight Glow","🌙 Up So Late?","💤 Sleepy Crew","🌟 Night Magic","🌃 Quiet Hours","🫶 Sleep Well","🌙 Night Welcome","🌌 Starry Sky","🦉 Who's Awake?","✨ Dream Hours","🌠 Stars Above","🌙 Hello Night","💜 Moon Mood","🌃 Late Hangout","💤 Rest Easy","🌙 Still Up?","🤗 Welcome Home"],["🌄 Dawn Nears","💤 Late Crew","🌅 Soon Sunrise","🌌 Pre-Dawn","☕ First Coffee","🦉 Dawn Owls","🌄 First Light","💜 Quiet Dawn","🌙 Before Dawn","✨ Early Hours","🌅 Dawn Hello","🌠 Dawn Watch","☕ Coffee First","🌌 Night To Day","🌄 New Day Soon","🌟 Early Glow","🐦 Birds Awake","🌙 Almost Day","🌅 Daybreak Soon","💫 Dawn Energy","🌄 Early Crew","💛 Up Already?","🌟 Dawn Magic","☕ Rise & Sip","🤗 Welcome Home"],["☀️ Rise & Shine","🌅 Good Morning","☕ Morning Y'all","🌞 Fresh Start","💛 Morning Smile","🌻 Sunshine Crew","✨ Hi Sunshine","🌤️ Bright Day","☕ Coffee Time","🌞 Wake Up Crew","🌅 Morning Glow","🐦 Early Birds","🫶 Glad U Came","🌻 New Day Hello","💛 Sunshine On","✨ Morning Magic","☀️ AM Cheer","🌞 Rise Again","🌤️ Hello Today","☕ Sip & Say Hi","🌻 Bloom Today","🌅 Sunrise Hello","💫 Fresh Energy","💛 AM Smiles","🌞 Day Ahead","🌤️ Happy AM","💛 AM Energy","🤗 Welcome Home"],["👋 Come Say Hey","🌞 Midmorning","☀️ Sunny Hello","🌼 Shine Today","💬 Morning Check","✨ Glad You Came","🌻 Morning Glow","🫶 Big Hello","☕ Second Cup","💛 Good Vibes","🌤️ Stay Bright","🌞 Hello Again","🎉 AM Cheers","☀️ Day Ahead","🌼 All Smiles","💬 Morning Chat","✨ Looks Good","🌻 Hello Friend","🫶 Feel At Home","☀️ AM Moments","💛 Bright Side","🌤️ Lovely Day","🌞 Come On In","🤗 Welcome Home"],["☀️ Afternoon Hi","🍃 Midday Hello","✨ Noon Glow","🌞 Lunch Hello","💬 Midday Chat","💛 Noon Day Hugs","🌻 Noon Smiles","☕ Midday Break","🫶 Relax A Bit","🍃 Afternoon Hi","🌤️ Noon Mood","💫 Midday Magic","☀️ Sunny Break","🌻 Midday Crew","💛 Daytime Joy","✨ Noon Shine","🌞 Bright Noon","🍃 Pause & Chat","💬 Lunch Lounge","☀️ Midday Cheer","💛 Hello At Noon","🌤️ Noon Buzz","🌻 Sunny Check","🫶 Happy To See","✨ Midday Vibes","🤗 Welcome Home"],["🌇 PM Crew","💬 Come Hang Out","🌻 Hey, Good Day","🌤️ Late Day Hi","🫶 Afternoon Hug","🌞 Still Shining","🍃 PM Chill","💛 After Work Hi","✨ Golden Hour","💬 Pop In & Chat","🌻 Daytime Crew","☀️ Day Shine","🍹 Take A Break","🌇 Sunset Soon","🫶 Welcome Back","🍃 Day Breeze","💫 Golden Day","💛 Good Day!","🌤️ Stay Awhile","🌞 Daily Delight","💬 Say Hey Folks","🌻 Good Day Gang","🌇 Before Sunset","✨ Chill Moment","🍃 Evening Nears","🤗 Welcome Home"],["🌆 Evening Vibes","🎉 Good Evening","🫶 Welcome In","🌇 Sunset Hello","💛 PM Smiles","🌙 Night Begins","✨ Golden Glow","🌆 Come Chill","💬 Evening Check","🍵 Unwind Here","🫶 Evening Hugs","🌆 Twilight Chat","💫 Night Crew Hi","🌙 Evening Hello","💛 Glad You Came","🌇 Sunset Crew","✨ Warm Evening","🍃 Time To Relax","💬 Evening Chats","🌆 Nightfall","🫶 Come On In","🌙 Day To Night","💫 Evening Shine","🌇 Sunset Smiles","💛 Hey, Evening","🤗 Welcome Home"],["🌙 Cozy Night","✨ Good Night","🌌 Night Lounge","💜 Night Smiles","🌠 Stars Are Out","🌙 Winding Down?","🫶 Cozy Welcome","✨ Night Hello","🌌 Starlit Hello","🌙 Late Evening","🍵 Wind Down","💫 Night Glow","🦉 Owls Welcome","🌌 Twilight Crew","🌙 Welcome Owls","✨ Stay A Little","💜 Cozy Hour","🌠 After Dark","🌙 Night Chill","🫶 Cozy Vibes","🌌 Moonlight Hi","💫 Sweet Dreams","🌙 Night Check","✨ Night's Young","🦉 Late Crew Hi","🤗 Welcome Home"]];
const GREETING_ENGINE_VERSION = "1.0.1";
const GREETING_TIME_ZONE = "America/New_York";
const COMMUNITY_BRANDS = {
  "Empress": { name: "Yammie Gang", greetings: ["👑 Yammie Gang, welcome home!", "💜 Yammie Gang, good to see you!", "✨ Yammie Gang, let's make today count!"] },
  "Blicky": { name: "Blicky Brigade", greetings: ["🛡️ Blicky Brigade, welcome home!", "⚡ Blicky Brigade, check in!", "🔥 Blicky Brigade, bring the energy!"] },
  "BestYouEvaHad": { name: "Besties", greetings: ["💖 Besties, welcome home!", "🌸 Besties, glad you're here!", "✨ Besties, make yourself at home!"] },
  "Red Kocaine": { name: "Kocaine Kartel", greetings: ["🔥 Kocaine Kartel, welcome home!", "❤️ Kocaine Kartel, good to see you!", "⚡ Kocaine Kartel, let's get active!"] },
  "Dawn Dotta": { name: "Momentum Movement", greetings: ["⚡ Momentum Movement, welcome home!", "💪 Momentum Movement, keep moving forward!", "🌟 Momentum Movement, glad you're here!"] }
};
function twoHourGreetingPeriod(now = new Date(), owner = "") {
  try {
    const p = statsLocalParts(now);
    const hour = Number(p.hour), period = Math.floor(hour / 2);
    if (!Number.isInteger(period) || period < 0 || period > 11) throw Error("invalid-Eastern-hour");
    const poolIndex = Math.floor(period * 2 / 3);
    const pool = GREETING_GROUPS[poolIndex];
    if (!Array.isArray(pool) || !pool.length) throw Error("missing-greeting-pool");
    const day = Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86400000);
    const periodsForPool = Array.from({ length: 12 }, (_, i) => i).filter(i => Math.floor(i * 2 / 3) === poolIndex);
    const slotIndex = periodsForPool.indexOf(period);
    const position = day * periodsForPool.length + slotIndex;
    const index = position % pool.length;
    const baseLabel = pool[index] || DEFAULT_GREETING;
    const label = owner && position % 6 === 5 ? communityGreeting(owner, Math.floor(position / 6)) : baseLabel;
    return { slot: p.year + "-" + p.month + "-" + p.day + "-" + period, period, poolIndex, index, label, baseLabel };
  } catch {
    return { slot: "fallback", period: null, poolIndex: null, index: null, label: DEFAULT_GREETING, baseLabel: DEFAULT_GREETING };
  }
}



function statsLocalParts(now = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: GREETING_TIME_ZONE, year: "numeric", month: "numeric", day: "numeric",
    weekday: "short", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(now).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
}
function holidayGreeting(now = new Date()) {
  const p = statsLocalParts(now), y = Number(p.year), m = Number(p.month), d = Number(p.day);
  const weekday = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
  const nth = (mm, wd, n) => 1 + (7 + wd - weekday(y, mm, 1)) % 7 + 7 * (n - 1);
  const last = (mm, wd) => {
    const end = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    return end - (7 + weekday(y, mm, end) - wd) % 7;
  };
  const fixed = {
    "1-1": "🎆🥂 Happy New Year, Everyone!",
    "2-4": "💜 World Cancer Day — sending strength and support",
    "2-14": "❤️🌹 Happy Valentine's Day!",
    "3-8": "🌷 Celebrating International Women's Day!",
    "3-17": "☘️💚 Happy St. Patrick's Day!",
    "4-22": "🌎🌱 Happy Earth Day!",
    "5-5": "🎉 Celebrating Mexican heritage and culture!",
    "6-19": "✊🏿🎉 Celebrating Juneteenth!",
    "7-4": "🇺🇸🎆 Happy Independence Day!",
    "7-30": "🤝💛 Happy International Day of Friendship!",
    "9-21": "🕊️ International Day of Peace",
    "10-10": "💚 World Mental Health Day — check in and be kind",
    "10-31": "🎃👻 Happy Halloween!",
    "11-11": "🇺🇸❤️ Honoring Our Veterans Today!",
    "11-13": "💛 World Kindness Day — spread a little kindness",
    "12-1": "❤️ World AIDS Day — honoring awareness and support",
    "12-10": "🕊️ Human Rights Day — dignity and respect for all",
    "12-25": "🎄✨ Merry Christmas, Everyone!",
    "12-31": "🎇🥂 New Year's Eve Celebration!"
  };
  if (fixed[m + "-" + d]) return fixed[m + "-" + d];
  if (m === 1 && d === nth(1, 1, 3)) return "🕊️✊🏿 Honoring Dr. Martin Luther King Jr.";
  if (m === 2 && d === nth(2, 1, 3)) return "🇺🇸✨ Presidents' Day Greetings!";
  if (m === 5 && d === nth(5, 0, 2)) return "💐❤️ Happy Mother's Day!";
  if (m === 5 && d === last(5, 1)) return "🇺🇸🕯️ Remembering on Memorial Day";
  if (m === 6 && d === nth(6, 0, 3)) return "💙👨 Happy Father's Day!";
  if (m === 9 && d === nth(9, 1, 1)) return "🛠️🎉 Happy Labor Day!";
  if (m === 11 && d === nth(11, 4, 4)) return "🦃🍂 Happy Thanksgiving, Everyone!";

  // Moving religious observances use Intl calendar data instead of hard-coded annual dates.
  try {
    const islamic = Object.fromEntries(new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
      timeZone: GREETING_TIME_ZONE, month: "numeric", day: "numeric"
    }).formatToParts(now).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
    const im = Number(islamic.month), id = Number(islamic.day);
    if (im === 9 && id === 1) return "🌙 Ramadan Mubarak!";
    if (im === 10 && id === 1) return "🌙✨ Eid al-Fitr Mubarak!";
    if (im === 12 && id === 10) return "🌙🤍 Eid al-Adha Mubarak!";
  } catch {}
  try {
    const hebrew = Object.fromEntries(new Intl.DateTimeFormat("en-US-u-ca-hebrew", {
      timeZone: GREETING_TIME_ZONE, month: "long", day: "numeric"
    }).formatToParts(now).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
    const hm = String(hebrew.month || "").toLowerCase(), hd = Number(hebrew.day);
    if ((hm.includes("tishri") || hm.includes("tishrei")) && hd === 1) return "🍎🍯 Shana Tova — Happy Rosh Hashanah!";
    if ((hm.includes("tishri") || hm.includes("tishrei")) && hd === 10) return "🤍 Wishing a meaningful Yom Kippur";
    if (hm.includes("kislev") && hd === 25) return "🕎 Happy Hanukkah!";
  } catch {}
  try {
    const chinese = Object.fromEntries(new Intl.DateTimeFormat("en-US-u-ca-chinese", {
      timeZone: GREETING_TIME_ZONE, month: "numeric", day: "numeric"
    }).formatToParts(now).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
    if (Number(chinese.month) === 1 && Number(chinese.day) === 1) return "🧧🏮 Happy Lunar New Year!";
  } catch {}

  // Seasonal transitions take precedence over month-long awareness themes on their exact dates.
  if (m === 3 && d === 20) return "🌷✨ Welcome, Spring!";
  if (m === 6 && d === 21) return "☀️🌴 Hello, Summer!";
  if (m === 9 && d === 22) return "🍁🍂 Welcome, Autumn!";
  if (m === 12 && d === 21) return "❄️✨ Winter Vibes Are Here!";
  if (m === 10 && d >= 25 && d < 31) return "🎃🍬 Spooky Season Is Here!";
  if (m === 12 && d >= 22 && d < 25) return "🎄🌟 Holiday Cheer Is in the Air!";

  if (m === 2) return "🖤 Honoring Black History Month";
  if (m === 3) return "🌷 Celebrating Women's History Month";
  if (m === 4) return "♾️ Celebrating Autism Acceptance Month";
  if (m === 5) return "🌏 Celebrating Asian American and Pacific Islander Heritage Month";
  if (m === 6) return "🏳️‍🌈 Celebrating Pride Month";
  if ((m === 9 && d >= 15) || (m === 10 && d <= 15)) return "🌎 Celebrating Hispanic Heritage Month";
  if (m === 10) return "🎗️ Breast Cancer Awareness and Disability Employment Awareness Month";
  if (m === 11) return "🪶 Honoring Native American Heritage Month";
  return null;
}

function holidayEmojiTheme(now = new Date()) {
  const label = String(holidayGreeting(now) || "");
  if (!label) return null;
  const s = label.toLowerCase();
  let key = "holiday";
  if (/new year/.test(s)) key = "newyear";
  else if (/valentine/.test(s)) key = "love";
  else if (/st\. patrick/.test(s)) key = "clover";
  else if (/halloween|spooky/.test(s)) key = "halloween";
  else if (/christmas|holiday cheer|winter vibes|hanukkah/.test(s)) key = "winter";
  else if (/thanksgiving/.test(s)) key = "harvest";
  else if (/native american/.test(s)) key = "native";
  else if (/pride/.test(s)) key = "pride";
  else if (/ramadan|eid al-/.test(s)) key = "crescent";
  else if (/rosh hashanah|yom kippur/.test(s)) key = "faith";
  else if (/lunar new year/.test(s)) key = "lunar";
  else if (/black history|juneteenth/.test(s)) key = "heritage";
  else if (/independence|presidents|memorial|veterans|labor day/.test(s)) key = "patriotic";
  else if (/women|mother's day|spring/.test(s)) key = "blossom";
  else if (/earth day/.test(s)) key = "nature";
  else if (/mexican heritage|asian american|hispanic heritage/.test(s)) key = "culture";
  else if (/cancer|autism|mental health|world aids|disability employment/.test(s)) key = "awareness";
  else if (/peace|human rights/.test(s)) key = "peace";
  else if (/friendship|father's day/.test(s)) key = "family";
  else if (/summer/.test(s)) key = "summer";
  else if (/autumn/.test(s)) key = "autumn";
  const base = {
    greeting:"✨", clock:"✨", members:"🎉", active:"🌟", idle:"🌙", dnd:"🔕",
    superfan:"✨", level50:"⭐", boosts:"🎁", live:"🌟", offline:"🌙"
  };
  const palettes = {
    newyear:{greeting:"🎆",clock:"✨",members:"🥂",active:"🌟",idle:"🌙",dnd:"🔕",superfan:"🎉",level50:"👑",boosts:"🎁",live:"🎇",offline:"⚫"},
    love:{greeting:"💝",clock:"💌",members:"💞",active:"❤️",idle:"🌹",dnd:"💔",superfan:"💘",level50:"💖",boosts:"🎁",live:"💗",offline:"🖤"},
    clover:{greeting:"☘️",clock:"🌈",members:"🍀",active:"💚",idle:"🌙",dnd:"🪙",superfan:"☘️",level50:"⭐",boosts:"🍀",live:"💚",offline:"🍂"},
    halloween:{greeting:"🎃",clock:"🕸️",members:"👻",active:"🎃",idle:"🌙",dnd:"🦇",superfan:"🍬",level50:"🕷️",boosts:"🧡",live:"🎃",offline:"👻"},
    winter:{greeting:"🎄",clock:"❄️",members:"🎁",active:"⭐",idle:"🌙",dnd:"🔕",superfan:"🎅",level50:"👑",boosts:"🎁",live:"🎄",offline:"❄️"},
    harvest:{greeting:"🦃",clock:"🍂",members:"🍁",active:"🌟",idle:"🌙",dnd:"🔕",superfan:"🧡",level50:"⭐",boosts:"🎁",live:"🍂",offline:"🌰"},
    native:{greeting:"🪶",clock:"🍂",members:"🧡",active:"🌟",idle:"🌙",dnd:"🔕",superfan:"🪶",level50:"⭐",boosts:"🎁",live:"🧡",offline:"🍂"},
    pride:{greeting:"🏳️‍🌈",clock:"🌈",members:"🏳️‍🌈",active:"🌈",idle:"🌙",dnd:"💜",superfan:"💖",level50:"⭐",boosts:"🎁",live:"🌈",offline:"🌙"},
    crescent:{greeting:"🌙",clock:"✨",members:"🌙",active:"⭐",idle:"🌙",dnd:"🤍",superfan:"🌟",level50:"✨",boosts:"🎁",live:"🌙",offline:"🌑"},
    faith:{greeting:"🕎",clock:"✨",members:"🍎",active:"⭐",idle:"🌙",dnd:"🤍",superfan:"🕎",level50:"✨",boosts:"🎁",live:"🕎",offline:"🌙"},
    lunar:{greeting:"🧧",clock:"🏮",members:"🧧",active:"✨",idle:"🌙",dnd:"🔕",superfan:"🐉",level50:"⭐",boosts:"🎁",live:"🏮",offline:"🌑"},
    heritage:{greeting:"✊🏿",clock:"✨",members:"❤️",active:"⭐",idle:"🌙",dnd:"🔕",superfan:"💚",level50:"👑",boosts:"🎁",live:"❤️",offline:"🌑"},
    patriotic:{greeting:"🇺🇸",clock:"⭐",members:"🇺🇸",active:"⭐",idle:"🌙",dnd:"🔕",superfan:"🎆",level50:"🏅",boosts:"🎁",live:"🇺🇸",offline:"🌙"},
    blossom:{greeting:"🌷",clock:"🌸",members:"🌷",active:"🌼",idle:"🌙",dnd:"🔕",superfan:"🌹",level50:"🌟",boosts:"🎁",live:"🌷",offline:"🌙"},
    nature:{greeting:"🌎",clock:"🌱",members:"🌍",active:"🌱",idle:"🌙",dnd:"🔕",superfan:"🌿",level50:"🌟",boosts:"🎁",live:"🌎",offline:"🌑"},
    culture:{greeting:"🌎",clock:"✨",members:"🎉",active:"🌟",idle:"🌙",dnd:"🔕",superfan:"🎊",level50:"⭐",boosts:"🎁",live:"🌎",offline:"🌙"},
    awareness:{greeting:"🎗️",clock:"💚",members:"🤝",active:"💚",idle:"🌙",dnd:"🔕",superfan:"💛",level50:"⭐",boosts:"🎁",live:"💚",offline:"🌙"},
    peace:{greeting:"🕊️",clock:"✨",members:"🤝",active:"🕊️",idle:"🌙",dnd:"🤍",superfan:"💛",level50:"⭐",boosts:"🎁",live:"🕊️",offline:"🌑"},
    family:{greeting:"💙",clock:"✨",members:"👨‍👩‍👧‍👦",active:"💙",idle:"🌙",dnd:"🔕",superfan:"💛",level50:"⭐",boosts:"🎁",live:"💙",offline:"🌙"},
    summer:{greeting:"☀️",clock:"🌴",members:"🌞",active:"☀️",idle:"🌙",dnd:"🔕",superfan:"🌻",level50:"⭐",boosts:"🎁",live:"☀️",offline:"🌙"},
    autumn:{greeting:"🍁",clock:"🍂",members:"🍁",active:"🌟",idle:"🌙",dnd:"🔕",superfan:"🍂",level50:"⭐",boosts:"🎁",live:"🍁",offline:"🌑"}
  };
  return {key,prefix:palettes[key] ? palettes[key].greeting : base.greeting,...base,...(palettes[key]||{})};
}
function applyHolidayEmojiTheme(key, value, theme) {
  if (!theme || typeof value !== "string") return value;
  if (key === "greeting") return theme.prefix + " " + value;
  if (key === "clock") return value.replace(/^📅/u, theme.clock);
  if (key === "members") return value.replace(/^👥/u, theme.members);
  if (key === "presence") return value.replace(/^🟢/u, theme.active).replace(/🌙/u, theme.idle).replace(/⛔/u, theme.dnd);
  if (key === "superfan") return value.replace(/^⭐/u, theme.superfan);
  if (key === "level50") return value.replace(/^👑/u, theme.level50);
  if (key === "boosts") return value.replace(/^🚀/u, theme.boosts);
  if (key === "live") return value.replace(/^(?:🔴|⚫)/u, /NOT LIVE/u.test(value) ? theme.offline : theme.live);
  return value;
}

function weekdayGreeting(now = new Date()) {
  const p = statsLocalParts(now), y = Number(p.year), m = Number(p.month), d = Number(p.day), hour = Number(p.hour);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(), period = Math.floor(hour / 2);
  const schedules = {
    0: { period: 4, phrases: ["🌿 Sunday Reset — recharge and reconnect", "☀️ Slow down, reset, and enjoy Sunday"] },
    1: { period: 3, phrases: ["💪 Monday Motivation — start strong", "✨ New week, fresh energy"] },
    2: { period: 3, phrases: ["🌟 Tuesday Energy — keep building", "🚀 Make today a step forward"] },
    3: { period: 3, phrases: ["🌈 Midweek Momentum — you're doing great", "💛 Wednesday check-in — keep going"] },
    4: { period: 3, phrases: ["🤝 Thursday Together — glad we're here", "✨ One more day, one more chance to shine"] },
    5: { period: 3, phrases: ["🎉 Friday Vibes — let's finish strong", "🥳 It's Friday — bring the good energy"] },
    6: { period: 4, phrases: ["🥳 Saturday Social — come hang out", "☀️ Saturday is better together"] }
  };
  const entry = schedules[weekday];
  if (!entry || entry.period !== period) return null;
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  const week = Math.floor(day / 7);
  return entry.phrases[week % entry.phrases.length];
}
function communityGreeting(owner, sequence = 0) {
  const brand = COMMUNITY_BRANDS[owner];
  if (!brand) return DEFAULT_GREETING;
  return brand.greetings[Math.abs(Number(sequence) || 0) % brand.greetings.length];
}
function safeChannelLabel(value) {
  const chars = Array.from(String(value || ""));
  return chars.length <= 100 ? chars.join("") : chars.slice(0, 100).join("").trimEnd();
}
function resolveScheduledEventGreeting(owner, events, now = new Date()) {
  if (!Array.isArray(events)) return null;
  const timestamp = now.getTime();
  const active = events.filter(e => {
    const starts = Date.parse(String(e.scheduled_start_time || ""));
    const ends = Date.parse(String(e.scheduled_end_time || ""));
    return Number.isFinite(starts) && [1, 2].includes(e.status) &&
      starts <= timestamp + 90 * 60000 &&
      (Number.isFinite(ends) ? ends > timestamp : starts + 4 * 3600000 > timestamp);
  }).sort((a, b) => {
    const aOverride = /^greeting override\s*:/i.test(String(a.name || ""));
    const bOverride = /^greeting override\s*:/i.test(String(b.name || ""));
    if (aOverride !== bOverride) return aOverride ? -1 : 1;
    return Date.parse(a.scheduled_start_time) - Date.parse(b.scheduled_start_time);
  })[0];
  if (!active) return null;
  const title = String(active.name || "").replace(/[\r\n\t]+/g, " ").trim();
  if (/^greeting override\s*:/i.test(title)) {
    const custom = title.replace(/^greeting override\s*:\s*/i, "").trim();
    if (custom) return safeChannelLabel(custom);
  }
  if (/birthday/i.test(title)) return title.toLowerCase().includes(String(owner).toLowerCase()) ? "🎂🥳 Happy Birthday, " + owner + "!" : "🎂🥳 Community Birthday Celebration!";
  if (/anniversary/i.test(title)) return "🎉💖 Celebrating Our Community Anniversary!";
  if (/battle|face.?off|versus|elimination|box battle/i.test(title)) return "⚔️🔥 " + owner + " Battle Night!";
  if (/\b(live|livestream|live stream|streaming)\b/i.test(title)) return "🔴 " + owner + " is LIVE — come show some love!";
  if (/graduat|commencement/i.test(title)) return "🎓🎉 Celebrating our graduates!";
  if (/milestone|achievement|celebrat/i.test(title)) return "🏆✨ " + safeChannelLabel(title) + "!";
  if (!title) return null;
  const prefix = "🎉✨ ", suffix = " • Happening Soon!";
  const maxTitle = 100 - Array.from(prefix + suffix).length;
  return safeChannelLabel(prefix + Array.from(title).slice(0, maxTitle).join("").trimEnd() + suffix);
}
function resolveGreeting(owner, events = [], now = new Date()) {
  return resolveScheduledEventGreeting(owner, events, now) ||
    twoHourGreetingPeriod(now, owner).label ||
    communityGreeting(owner, 0) ||
    DEFAULT_GREETING;
}
async function occasionGreeting(owner, request, guildId, now = new Date()) {
  try {
    const events = await request("/guilds/" + guildId + "/scheduled-events");
    const eventGreeting = resolveScheduledEventGreeting(owner, events, now);
    if (eventGreeting) {
      const period = twoHourGreetingPeriod(now, owner);
      console.log(JSON.stringify({ event: "community-stats-greeting-event-override", owner, slot: period.slot, label: eventGreeting }));
      return eventGreeting;
    }
  } catch (e) {
    console.warn(JSON.stringify({ event: "stats-event-lookup-skipped", reason: String(e?.message || e).slice(0, 90) }));
  }
  const period = twoHourGreetingPeriod(now, owner);
  const label = period.label || communityGreeting(owner, 0) || DEFAULT_GREETING;
  console.log(JSON.stringify({ event: "community-stats-greeting-rotation-selected", owner, slot: period.slot, label }));
  return label;
}

// Momentum Movement's independent Community Stats sync.
// Stable required channel IDs; optional count rows use verified dynamic channel identity.
// 10-minute schedule. Presence breakdown and owner LIVE are never guessed.
const GUILD="1565048205970767992";
const APP="1565304619838742598";
const CATEGORY="1566030078964539432";
const TARGET={
 greeting:"1566030413842096241",
 clock:"1566030421635104768",
 members:"1566030474034282537",
 presence:"1568475840470192344",
 superfan:"1569452169374204005",
 boosts:"1569452187933737073",
 level50:"1569452177129214003",
 live:"1566030504635924600"
};

const OPTIONAL_STATS=new Set(["superfan","boosts","level50"]);
const STAT_PREFIX={
 superfan:/^(?:⭐\s*Super Fan Subscribers?\b|🎟️\s*Super Fans?(?: Subscriber| Access)?\b)/u,
 boosts:/^🚀\s*(?:Server Boosts?|Boosts?)\b/u,
 level50:/^(?:👑\s*Fan Club Level 50\b|🏆\s*(?:Level 50 Access|Fan Club Level 50)\b)/u
};
const ROLES={
 superfan:"1565571008822386788",
 level50:"1565571007190794340",
};
const TOKEN=Bun.env.DISCORD_BOT_TOKEN||"";
if(Bun.env.APPLICATION_ID!==APP||Bun.env.AUTHORIZED_GUILD_ID!==GUILD||!TOKEN)
  throw Error("Momentum Movement guild/app credentials missing or mismatched");
const ENABLE_WRITES=Bun.env.ENABLE_STATS_WRITES==="true";
const DIAGNOSTIC=Bun.env.STATS_DIAGNOSTIC==="true";
console.log(JSON.stringify({event:"momentum_stats_sync_started",writeCapable:ENABLE_WRITES,diagnostic:DIAGNOSTIC,clockTime:new Date().toISOString()}));
async function api(path,method="GET",body){
  // Owner-controlled layout: statistic jobs may update labels, never channel structure or order.
  const __layoutMethod=String(method||"GET").toUpperCase();
  const __layoutParts=String(path||"").split("/").filter(Boolean);
  const __layoutDigits=s=>s.length>0&&Array.from(s).every(c=>c>="0"&&c<="9");
  const __isChannelCollection=__layoutParts[__layoutParts.length-1]==="channels";
  const __isSingleChannel=__layoutParts.length===2&&__layoutParts[0]==="channels"&&__layoutDigits(__layoutParts[1]);
  const __isGuildChannels=__layoutParts.length===3&&__layoutParts[0]==="guilds"&&__layoutDigits(__layoutParts[1])&&__layoutParts[2]==="channels";
  if((__layoutMethod==="POST"&&__isChannelCollection)||
     (__layoutMethod==="PATCH"&&(__isGuildChannels||(__isSingleChannel&&body&&("position" in body||"parent_id" in body))))||
     (__layoutMethod==="DELETE"&&__isSingleChannel)) {
    throw Error("Owner-managed Community Stats layout: automated channel creation, movement, and deletion are disabled");
  }

 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch("https://discord.com/api/v10"+path,{
   method,headers:{Authorization:"Bot "+TOKEN,"Content-Type":"application/json"},
   body:body===undefined?undefined:JSON.stringify(body),
   signal:AbortSignal.timeout(15000)
  });
  let data=null;try{data=await r.json()}catch{}
  if(r.status===429){if(attempt===2)throw Error("Discord rate limit exhausted");await Bun.sleep(Math.max(1100,Math.ceil(Number(data?.retry_after||2)*1000)+300));continue}
  if(!r.ok)throw Error("Discord "+method+" "+r.status+" for "+path.split("?")[0]);
  return data;
 }
 throw Error("Discord API retries exhausted");
}
const [me,guild,channels,roles]=await Promise.all([
 api("/users/@me"),api("/guilds/"+GUILD+"?with_counts=true"),
 api("/guilds/"+GUILD+"/channels"),api("/guilds/"+GUILD+"/roles")
]);
if(me.id!==APP||guild.id!==GUILD||!Array.isArray(channels)||!Array.isArray(roles))throw Error("Guild authorization failure");
console.log(JSON.stringify({event:"momentum_stats_sync_verified_scope",channels:channels.length,roles:roles.length}));
// The original Community Stats category may be renamed, moved, or removed by an owner.
const actual={};
for(const [key,id] of Object.entries(TARGET)){
 const found=channels.find(c=>c.id===id);
 if(!found){if(OPTIONAL_STATS.has(key))continue;throw Error("Verified required stats channel missing: "+key)}
 if(found.guild_id!==GUILD||found.type!==2)throw Error("Invalid stats channel: "+key);
 actual[key]=found;
}
if(!actual.members?.parent_id)throw Error("Stats parent unavailable");
for(const key of OPTIONAL_STATS){
 const matches=channels.filter(c=>c.guild_id===GUILD&&c.type===2&&c.parent_id===actual.members.parent_id&&STAT_PREFIX[key].test(c.name));
 if(matches.length>1||(actual[key]&&matches.length&&actual[key].id!==matches[0].id))
  throw Error("Duplicate optional stats row: "+key);
 if(!actual[key]&&matches.length)actual[key]=matches[0];
}
let members=[],memberComplete=false;
try {
 let last="";
 for(let i=0;i<10;i++){
  const batch=await api("/guilds/"+GUILD+"/members?limit=1000"+(last?"&after="+last:""));
  if(!Array.isArray(batch))throw Error("Member list shape invalid");
  members.push(...batch);
  if(batch.length<1000){memberComplete=true;break}
  last=batch[batch.length-1]?.user?.id||"";
  if(!last)break;
 }
}catch(err){console.error(JSON.stringify({event:"stats_members_unavailable",error:err instanceof Error?err.message.slice(0,90):"unknown"}))}
// Use the existing guild-authorized bot Gateway; never create a second Gateway connection.
let verifiedPresence=null;
let presenceReason="existing-bot-unavailable";
try{
 const host="blickymania-bot-005.railway.internal";
 for(const port of [8081,8080]){
  try{
   const r=await fetch("http://"+host+":"+port+"/_internal/stats-presences",{
    method:"GET",headers:{authorization:"Bot "+TOKEN,"x-guild-id":GUILD},
    signal:AbortSignal.timeout(2600)
   });
   if(!r.ok){presenceReason="internal-status-"+r.status;continue;}
   const data=await r.json();
   const asOf=Date.parse(String(data.asOf||""));
   if(data.verified!==true||data.guild!==GUILD||!Number.isFinite(asOf)||Math.abs(Date.now()-asOf)>120000){
    presenceReason=String(data.reason||"unverified-existing-bot-snapshot").slice(0,80);continue;
   }
   if(!memberComplete){presenceReason="member-list-incomplete";continue;}
   const entries=data.presences;
   const all={online:0,idle:0,dnd:0},humansOnly={online:0,idle:0,dnd:0};
   const roster=new Map(members.filter(m=>typeof m.user?.id==="string").map(m=>[m.user.id,!!m.user.bot]));
   const seen=new Set();
   let valid=Array.isArray(entries)&&entries.length<=members.length;
   if(valid){
    for(const entry of entries){
     if(typeof entry?.id!=="string"||!roster.has(entry.id)||seen.has(entry.id)||!["online","idle","dnd"].includes(entry.status)){valid=false;break;}
     seen.add(entry.id);
     all[entry.status]++;
     if(roster.get(entry.id)===false)humansOnly[entry.status]++;
    }
   }
   if(!valid){presenceReason="invalid-or-incomplete-gateway-roster";continue;}
   const total=all.online+all.idle+all.dnd;
   if(!Number.isSafeInteger(guild.approximate_presence_count)||total!==guild.approximate_presence_count||
      all.online!==Number(data.online)||all.idle!==Number(data.idle)||all.dnd!==Number(data.dnd)){
    presenceReason="gateway-and-rest-presence-disagree";continue;
   }
   verifiedPresence=humansOnly;
   presenceReason="human-presence-from-verified-bot-gateway";
   break;
  }catch(e){presenceReason=e instanceof Error?e.name.slice(0,60):"network-error";}
 }
}catch(e){presenceReason=e instanceof Error?e.name.slice(0,60):"unknown";}
const proposals=[],skipped=[];const desiredVisibility={},optionalLabels={};

const holidayEmoteSelfTests = (() => {
 const christmas = holidayEmojiTheme(new Date("2026-12-25T12:00:00-05:00"));
 const thanksgiving = holidayEmojiTheme(new Date("2026-11-26T12:00:00-05:00"));
 const standard = holidayEmojiTheme(new Date("2026-08-14T12:00:00-04:00"));
 const original = "👥 2 Members | 🤖 3 Bots";
 return [
  ["christmas_theme_selected",christmas?.key==="winter"],
  ["thanksgiving_theme_selected",thanksgiving?.key==="harvest"],
  ["standard_emotes_restored_outside_window",standard===null],
  ["member_label_and_value_preserved",applyHolidayEmojiTheme("members",original,christmas)==="🎁 2 Members | 🤖 3 Bots"],
  ["greeting_text_retained",applyHolidayEmojiTheme("greeting","✨ Good Evening",christmas)==="🎄 ✨ Good Evening"]
 ];
})();
if(!holidayEmoteSelfTests.every(x=>x[1]))throw Error("Holiday emoji theme self-test failed: "+JSON.stringify(holidayEmoteSelfTests));
console.log(JSON.stringify({event:"community-stats-holiday-emote-selftest",passed:true,checks:holidayEmoteSelfTests}));

const activeHolidayTheme=holidayEmojiTheme(new Date());
function propose(key,next){
 const themed=applyHolidayEmojiTheme(key,next,activeHolidayTheme);
 if(typeof themed!=="string"||!themed.length||Array.from(themed).length>100){
  skipped.push({key,reason:"invalid candidate"});return;
 }
 if(OPTIONAL_STATS.has(key)){optionalLabels[key]=themed;return;}
 const before=actual[key].name;
 if(before!==themed)proposals.push({key,id:TARGET[key],before,after:themed});
}
function clockName(date=new Date()){
 const map=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true}).formatToParts(date).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
 return "📅 "+map.weekday+" "+map.month+"/"+map.day+" • "+map.hour+":"+map.minute+" "+map.dayPeriod+" ET";
}
propose("greeting",(await occasionGreeting("Dawn Dotta",(path)=>api(path),GUILD))||twoHourGreetingPeriod(new Date(),"Dawn Dotta").label);
propose("clock",clockName());
if(memberComplete){
 const humans=members.filter(m=>m.user&&!m.user.bot).length;
 const bots=members.filter(m=>m.user?.bot).length;
 propose("members","👥 "+humans+" Members | 🤖 "+bots+" Bots");
 if(verifiedPresence)propose("presence","🟢 "+verifiedPresence.online+" Active | 🌙 "+verifiedPresence.idle+" Idle | ⛔ "+verifiedPresence.dnd+" DND");
 else skipped.push({key:"presence",reason:"verified Gateway snapshot unavailable"});
 for(const [key,label,requiredName] of [
  ["superfan","⭐ Super Fan Subscribers • ","Super Fan Lounge Access"],
  ["level50","👑 Fan Club Level 50 • ","Level 50 Lounge Access"],
 ]){
  const r=roles.find(x=>x.id===ROLES[key]);
  if(!r||!r.name.includes(requiredName)){skipped.push({key,reason:"expected access role absent"});continue}
  const count=members.filter(m=>!m.user?.bot&&Array.isArray(m.roles)&&m.roles.includes(r.id)).length;
  propose(key,label+count);
  desiredVisibility[key]=count;
 }
}else skipped.push({key:"members_and_roles",reason:"complete Discord member list unavailable"});
if(Number.isSafeInteger(guild.premium_subscription_count)&&guild.premium_subscription_count>=0){
 propose("boosts","🚀 Server Boosts • "+guild.premium_subscription_count);
 desiredVisibility.boosts=guild.premium_subscription_count;
}
if(!verifiedPresence)skipped.push({key:"presence_breakdown",reason:presenceReason});
console.log(JSON.stringify({event:"momentum_stats_sync_evaluated",proposals:proposals.length,writesEnabled:ENABLE_WRITES,diagnostic:DIAGNOSTIC,memberComplete,presenceVerified:!!verifiedPresence}));
skipped.push({key:"live",reason:"owner LIVE and duration source not independently verified; existing display preserved"});
const report={event:"momentum_stats_sync",community:"Momentum Movement",guild:GUILD,
 category:CATEGORY,holidayEmoteTheme:activeHolidayTheme?.key||"standard",memberComplete,memberCount:memberComplete?members.length:null,presenceVerified:!!verifiedPresence,presence:verifiedPresence,presenceReason,
 readOnly:!ENABLE_WRITES,diagnostic:DIAGNOSTIC,proposals,skipped};
if(DIAGNOSTIC)throw new Error("MM_STATS_PLAN:"+JSON.stringify(report));
let writes=0;
if(ENABLE_WRITES){
 for(const change of proposals){
  const verify=await api("/channels/"+change.id);
  if(verify.id!==change.id||verify.guild_id!==GUILD||verify.name!==change.before||verify.type!==2)
   throw Error("Concurrent channel drift detected: "+change.key);
  await api("/channels/"+change.id,"PATCH",{name:change.after});
  const check=await api("/channels/"+change.id);
  if(check.id!==change.id||check.guild_id!==GUILD||check.type!==2||check.name!==change.after)throw Error("Unverified stats update: "+change.key);
  writes++;
 }

 for(const [key,count] of Object.entries(desiredVisibility)){
  if(!Number.isSafeInteger(count)||count<0)throw Error("Unverified optional count: "+key);
  const ch=actual[key],name=optionalLabels[key];
  if(typeof name!=="string"||!name||Array.from(name).length>100)throw Error("Invalid optional stats label: "+key);
  /* Zero is valid: always keep this statistic visible. */
  if(!ch){
   const template=await api("/channels/"+actual.members.id);
   if(template.guild_id!==GUILD||template.type!==2||template.parent_id!==actual.members.parent_id)
    throw Error("Optional stats template changed: "+key);
   const fresh=await api("/guilds/"+GUILD+"/channels");
   if(!Array.isArray(fresh)||fresh.some(c=>c.guild_id===GUILD&&c.type===2&&c.parent_id===template.parent_id&&STAT_PREFIX[key].test(c.name)))
    throw Error("Optional stats concurrent creation detected: "+key);
   const overwrites=(template.permission_overwrites||[]).map(o=>({id:o.id,type:o.type,allow:String(o.allow),deny:String(o.deny)}));
   let everyone=overwrites.find(o=>o.id===GUILD&&o.type===0);
   if(!everyone){everyone={id:GUILD,type:0,allow:"0",deny:"0"};overwrites.push(everyone);}
   everyone.allow=((BigInt(everyone.allow)|1024n)&~1048576n).toString();
   everyone.deny=((BigInt(everyone.deny)|1048576n)&~1024n).toString();
   const position=Number(template.position)+({superfan:2,level50:3,boosts:4}[key]);
   const created=await api("/guilds/"+GUILD+"/channels","POST",{
    type:2,name,parent_id:template.parent_id,position:Number.isFinite(position)?position:undefined,permission_overwrites:overwrites
   });
   if(!created?.id||created.guild_id!==GUILD||created.type!==2||created.name!==name)
    throw Error("Optional stats creation failed: "+key);
   const checked=await api("/channels/"+created.id);
   const access=checked.permission_overwrites?.find(o=>o.id===GUILD&&o.type===0);
   if(checked.guild_id!==GUILD||checked.parent_id!==template.parent_id||checked.name!==name||
      !access||(BigInt(access.allow)&1024n)===0n||(BigInt(access.deny)&1024n)!==0n)
    throw Error("Optional stats creation readback failed: "+key);
   actual[key]=checked;
   console.log(JSON.stringify({event:"optional-stat-row-created",guild:GUILD,key,newId:created.id,quiet:true}));
   writes++;
   continue;
  }
  const latest=await api("/channels/"+ch.id);
  if(latest?.id!==ch.id||latest?.guild_id!==GUILD||latest?.type!==2||!STAT_PREFIX[key].test(String(latest?.name||""))){
   console.log(JSON.stringify({event:"optional-stat-row-preserved-skip",guild:GUILD,key,channelId:ch.id,observedName:latest?.name||null,reason:"owner-managed-or-renamed-channel",writes:0,quiet:true}));
   continue;
  }
  if(latest.name!==name){await api("/channels/"+ch.id,"PATCH",{name});writes++;}
  const current=await api("/channels/"+ch.id);
  const everyone=current.permission_overwrites?.find(o=>o.id===GUILD&&o.type===0);
  if(!everyone)throw Error("Stats everyone overwrite missing: "+key);
  const allow=BigInt(everyone.allow)|1024n,deny=BigInt(everyone.deny)&~1024n;
  if(allow!==BigInt(everyone.allow)||deny!==BigInt(everyone.deny)){
   await api("/channels/"+ch.id+"/permissions/"+GUILD,"PUT",{type:0,allow:allow.toString(),deny:deny.toString()});
   writes++;
  }
  const verified=await api("/channels/"+ch.id);
  if(verified.guild_id!==GUILD||verified.name!==name)throw Error("Optional stats row verification failed: "+key);
 }

}
console.log(JSON.stringify({...report,writes,unchanged:7-proposals.length}));
// Community Stats Fan Club row rollout 2026-11-09
