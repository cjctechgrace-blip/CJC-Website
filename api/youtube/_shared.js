const YOUTUBE_HANDLE = "cjcinternationalprophetyos9053";
const YOUTUBE_CHANNEL_ID = "UC3k6RTKZaDdG2ppZKNPLSBg";
const YOUTUBE_CHANNEL_URL = `https://www.youtube.com/@${YOUTUBE_HANDLE}`;
const YOUTUBE_LIVE_URL = `${YOUTUBE_CHANNEL_URL}/live`;
const YOUTUBE_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function stripTags(value = "") {
  return decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function matchOne(text, regex) {
  const match = text.match(regex);
  return match ? decodeHtml(match[1]).trim() : "";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; CJCWebsitePreview/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(`YouTube request failed: ${response.status}`);
  }

  return response.text();
}

export async function getYoutubeVideos(limit = 8) {
  const xml = await fetchText(YOUTUBE_FEED_URL);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((entryMatch) => {
      const entry = entryMatch[1];
      const videoId = matchOne(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/);
      const published = matchOne(entry, /<published>([^<]+)<\/published>/);
      const title = matchOne(entry, /<title>([\s\S]*?)<\/title>/);
      const description = stripTags(matchOne(entry, /<media:description>([\s\S]*?)<\/media:description>/));
      const watchUrl = matchOne(entry, /<link rel="alternate" href="([^"]+)"/) || `https://www.youtube.com/watch?v=${videoId}`;
      const thumbnail = matchOne(entry, /<media:thumbnail url="([^"]+)"/) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      return {
        videoId,
        title,
        date: formatDate(published),
        published,
        description,
        thumbnail,
        watchUrl
      };
    })
    .filter((video) => video.videoId && video.title && !/#shorts?\b/i.test(`${video.title} ${video.description}`))
    .slice(0, limit);
}

export async function getYoutubeLatest() {
  const [latestVideo] = await getYoutubeVideos(1);

  return {
    videoId: latestVideo?.videoId || "",
    title: latestVideo?.title || "Join The Livestream",
    date: latestVideo?.date || "",
    published: latestVideo?.published || "",
    description: latestVideo?.description || "",
    thumbnail: latestVideo?.thumbnail || "",
    watchUrl: latestVideo?.watchUrl || YOUTUBE_LIVE_URL,
    isLive: false,
    source: latestVideo ? "youtube-feed" : "youtube-fallback",
    channelUrl: YOUTUBE_CHANNEL_URL,
    liveUrl: YOUTUBE_LIVE_URL,
    fetchedAt: new Date().toISOString()
  };
}

export function sendJson(res, status, data, cacheControl = "public, max-age=120") {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.status(status).json(data);
}
