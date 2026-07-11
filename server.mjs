import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT;
if (!PORT) throw new Error("PORT env var is required");

const PUBLIC_DIR = path.join(__dirname, "public");
const YOUTUBE_HANDLE = "cjcinternationalprophetyos9053";
const YOUTUBE_CHANNEL_ID = "UC3k6RTKZaDdG2ppZKNPLSBg";
const YOUTUBE_CHANNEL_URL = `https://www.youtube.com/@${YOUTUBE_HANDLE}`;
const YOUTUBE_LIVE_URL = `${YOUTUBE_CHANNEL_URL}/live`;
const YOUTUBE_VIDEOS_URL = `${YOUTUBE_CHANNEL_URL}/videos`;
const YOUTUBE_STREAMS_URL = `${YOUTUBE_CHANNEL_URL}/streams`;
const YOUTUBE_FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_API_KEY || "";
const YOUTUBE_CACHE_MS = 5 * 60 * 1000;
const youtubeCache = {
  live: { expires: 0, data: null },
  videos: { expires: 0, data: null },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".otf":  "font/otf",
  ".mp4":  "video/mp4",
  ".webm": "video/webm",
  ".mp3":  "audio/mpeg",
  ".pdf":  "application/pdf",
};

function safeResolve(urlSegment) {
  const resolved = path.resolve(PUBLIC_DIR, "." + urlSegment);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    return null;
  }
  return resolved;
}

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
    year: "numeric",
  }).format(date);
}

function sendJson(res, status, data, cacheControl = "no-cache") {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
  });
  res.end(JSON.stringify(data));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; CJCWebsitePreview/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`YouTube request failed: ${response.status}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; CJCWebsitePreview/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`YouTube API request failed: ${response.status}`);
  }
  return response.json();
}

function extractBalancedJson(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return "";

  const start = text.indexOf("{", markerIndex);
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return "";
}

function extractYtInitialData(html) {
  const markers = [
    "var ytInitialData =",
    "window[\"ytInitialData\"] =",
    "ytInitialData =",
  ];

  for (const marker of markers) {
    const json = extractBalancedJson(html, marker);
    if (json) return JSON.parse(json);
  }

  throw new Error("YouTube videos tab data was not found");
}

function collectValuesByKey(value, key, out = []) {
  if (!value || typeof value !== "object") return out;

  if (Object.prototype.hasOwnProperty.call(value, key)) {
    out.push(value[key]);
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    collectValuesByKey(child, key, out);
  }

  return out;
}

function getTextValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.content === "string") return value.content;
  if (typeof value.simpleText === "string") return value.simpleText;
  if (typeof value.accessibilityText === "string") return value.accessibilityText;
  if (Array.isArray(value.runs)) return value.runs.map(getTextValue).join("");
  if (value.text) return getTextValue(value.text);
  if (value.title) return getTextValue(value.title);
  return "";
}

function getVideoIdFromUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl, "https://www.youtube.com");
    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function normalizeWatchUrl(rawUrl = "", videoId = "") {
  if (rawUrl.includes("/shorts/")) return "";
  if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  return "";
}

function isWatchUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl, "https://www.youtube.com");
    return url.hostname.endsWith("youtube.com") && url.pathname === "/watch" && Boolean(url.searchParams.get("v"));
  } catch {
    return false;
  }
}

function isUnavailableYoutubeVideo(video = {}) {
  const text = `${video.title || ""} ${video.description || ""}`.toLowerCase();
  return (
    !video.videoId ||
    !video.watchUrl ||
    !isWatchUrl(video.watchUrl) ||
    video.watchUrl.includes("/shorts/") ||
    (video.privacyStatus && video.privacyStatus !== "public") ||
    /\b(private video|deleted video|video unavailable|this video is unavailable|members only)\b/i.test(text)
  );
}

function getThumbnailSources(lockup) {
  return (
    lockup?.contentImage?.thumbnailViewModel?.image?.sources ||
    lockup?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image?.sources ||
    []
  );
}

function largestThumbnailFromSources(sources = []) {
  return [...sources]
    .filter((source) => source?.url)
    .sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))[0]?.url || "";
}

async function thumbnailExists(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CJCWebsitePreview/1.0)",
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function bestThumbnailForVideo(videoId, sources = []) {
  const fallback = largestThumbnailFromSources(sources);
  const candidates = [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];

  for (const candidate of candidates) {
    if (await thumbnailExists(candidate)) return candidate;
  }

  return fallback || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function collectMetadataTexts(lockup) {
  const metadata = lockup?.metadata?.lockupMetadataViewModel?.metadata || {};
  const rows = metadata?.contentMetadataViewModel?.metadataRows || metadata?.metadataRows || [];
  const texts = [];

  for (const row of rows) {
    for (const part of row.metadataParts || []) {
      const text = stripTags(getTextValue(part.text) || getTextValue(part));
      if (text) texts.push(text);
    }
  }

  return [...new Set(texts)];
}

function getPublishedText(metadataTexts) {
  return metadataTexts.find((text) => {
    return /\b(ago|streamed|premiered|scheduled|yesterday)\b/i.test(text) && !/\bviews?\b/i.test(text);
  }) || "";
}

function parseDurationSeconds(duration = "") {
  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return 0;

  const [, days = 0, hours = 0, minutes = 0, seconds = 0] = match.map((value) => Number(value || 0));
  return (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;
}

function pickOfficialThumbnail(thumbnails = {}) {
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    ""
  );
}

async function getYoutubeVideosFromFeed(limit = 30) {
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
        watchUrl,
      };
    })
    .filter((video) => video.videoId && video.title)
    .slice(0, limit);
}

async function enrichWithFeedData(videos) {
  try {
    const feedVideos = await getYoutubeVideosFromFeed(40);
    const feedById = new Map(feedVideos.map((video) => [video.videoId, video]));

    return videos.map((video) => {
      const feedVideo = feedById.get(video.videoId);
      if (!feedVideo) return video;
      return {
        ...video,
        date: feedVideo.date || video.date,
        published: feedVideo.published || video.published,
        description: feedVideo.description || video.description,
      };
    });
  } catch {
    return videos;
  }
}

async function enrichWithOfficialYoutubeApi(videos) {
  if (!YOUTUBE_DATA_API_KEY || !videos.length) return videos;

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails,status,liveStreamingDetails");
    url.searchParams.set("id", videos.map((video) => video.videoId).join(","));
    url.searchParams.set("key", YOUTUBE_DATA_API_KEY);

    const data = await fetchJson(url);
    const detailsById = new Map((data.items || []).map((item) => [item.id, item]));

    return videos.map((video) => {
      const item = detailsById.get(video.videoId);
      if (!item) return video;

      const snippet = item.snippet || {};
      const officialThumbnail = pickOfficialThumbnail(snippet.thumbnails);
      const durationSeconds = parseDurationSeconds(item.contentDetails?.duration);
      const liveDetails = item.liveStreamingDetails || {};

      return {
        ...video,
        title: snippet.title || video.title,
        date: formatDate(liveDetails.actualStartTime || snippet.publishedAt) || video.date,
        published: liveDetails.actualStartTime || snippet.publishedAt || video.published,
        description: snippet.description || video.description,
        thumbnail: officialThumbnail || video.thumbnail,
        durationSeconds: durationSeconds || video.durationSeconds,
        actualStartTime: liveDetails.actualStartTime || video.actualStartTime,
        liveBroadcastContent: snippet.liveBroadcastContent || video.liveBroadcastContent,
        privacyStatus: item.status?.privacyStatus || video.privacyStatus,
      };
    });
  } catch {
    return videos;
  }
}

async function getYoutubeVideosFromChannelTab(tabUrl, limit = 8) {
  const html = await fetchText(tabUrl);
  const initialData = extractYtInitialData(html);
  const lockups = collectValuesByKey(initialData, "lockupViewModel");
  const seen = new Set();
  const videos = [];

  for (const lockup of lockups) {
    if (lockup?.contentType && lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") continue;

    const command = lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand || {};
    const rawUrl = command?.commandMetadata?.webCommandMetadata?.url || "";
    const videoId = lockup?.contentId || command?.watchEndpoint?.videoId || getVideoIdFromUrl(rawUrl);
    const watchUrl = normalizeWatchUrl(rawUrl, videoId);

    if (!videoId || seen.has(videoId) || !watchUrl || watchUrl.includes("/shorts/")) continue;

    const title = stripTags(getTextValue(lockup?.metadata?.lockupMetadataViewModel?.title || lockup?.title));
    if (!title) continue;

    const metadataTexts = collectMetadataTexts(lockup);
    const thumbnailSources = getThumbnailSources(lockup);

    seen.add(videoId);
    videos.push({
      videoId,
      title,
      date: getPublishedText(metadataTexts),
      published: "",
      description: "",
      thumbnail: largestThumbnailFromSources(thumbnailSources),
      thumbnailSources,
      watchUrl,
    });

    if (videos.length >= limit) break;
  }

  if (!videos.length) throw new Error("YouTube videos tab returned no videos");

  return Promise.all(videos.map(async (video) => {
    const thumbnail = await bestThumbnailForVideo(video.videoId, video.thumbnailSources);
    const { thumbnailSources, ...cleanVideo } = video;
    return { ...cleanVideo, thumbnail };
  }));
}

async function getYoutubeVideosFromVideosTab(limit = 8) {
  return getYoutubeVideosFromChannelTab(YOUTUBE_VIDEOS_URL, limit);
}

async function getYoutubeStreamsFromStreamsTab(limit = 6) {
  let streams = await getYoutubeVideosFromChannelTab(YOUTUBE_STREAMS_URL, Math.max(limit, 8));
  streams = await enrichWithFeedData(streams);
  streams = await enrichWithOfficialYoutubeApi(streams);
  return streams.filter((video) => !isUnavailableYoutubeVideo(video)).slice(0, limit);
}

async function getYoutubeVideos(limit = 8) {
  const now = Date.now();
  if (youtubeCache.videos.data && youtubeCache.videos.expires > now) {
    return youtubeCache.videos.data.slice(0, limit);
  }

  try {
    let videos = await getYoutubeVideosFromVideosTab(Math.max(limit, 12));
    videos = await enrichWithFeedData(videos);
    videos = await enrichWithOfficialYoutubeApi(videos);

    youtubeCache.videos = { expires: now + YOUTUBE_CACHE_MS, data: videos };
    return videos.slice(0, limit);
  } catch {
    try {
      let videos = await getYoutubeVideosFromFeed(Math.max(limit, 12));
      videos = videos.filter((video) => !/#shorts?\b/i.test(`${video.title} ${video.description}`));
      videos = await enrichWithOfficialYoutubeApi(videos);

      if (videos.length) {
        youtubeCache.videos = { expires: now + YOUTUBE_CACHE_MS, data: videos };
        return videos.slice(0, limit);
      }
    } catch {
      // Keep the last successful response if YouTube is temporarily unavailable.
    }

    if (youtubeCache.videos.data) return youtubeCache.videos.data.slice(0, limit);
    return [];
  }
}

async function getOfficialYoutubeBroadcast(eventType = "live") {
  if (!YOUTUBE_DATA_API_KEY) return null;

  try {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("channelId", YOUTUBE_CHANNEL_ID);
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("eventType", eventType);
    searchUrl.searchParams.set("order", "date");
    searchUrl.searchParams.set("maxResults", "5");
    searchUrl.searchParams.set("key", YOUTUBE_DATA_API_KEY);

    const searchData = await fetchJson(searchUrl);
    const ids = (searchData.items || [])
      .map((item) => item.id?.videoId)
      .filter(Boolean);
    if (!ids.length) return null;

    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    detailsUrl.searchParams.set("part", "snippet,status,liveStreamingDetails,contentDetails");
    detailsUrl.searchParams.set("id", ids.join(","));
    detailsUrl.searchParams.set("key", YOUTUBE_DATA_API_KEY);

    const detailsData = await fetchJson(detailsUrl);
    for (const item of detailsData.items || []) {
      const snippet = item.snippet || {};
      const status = item.status || {};
      const liveDetails = item.liveStreamingDetails || {};
      const videoId = item.id;
      const video = {
        videoId,
        title: snippet.title || "Join The Livestream",
        date: formatDate(liveDetails.actualStartTime || snippet.publishedAt),
        published: liveDetails.actualStartTime || snippet.publishedAt || "",
        description: snippet.description || "",
        thumbnail: pickOfficialThumbnail(snippet.thumbnails) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        durationSeconds: parseDurationSeconds(item.contentDetails?.duration),
        isLive: eventType === "live" || snippet.liveBroadcastContent === "live",
        liveBroadcastContent: snippet.liveBroadcastContent,
        privacyStatus: status.privacyStatus,
        source: `youtube-api-${eventType}`,
      };

      if (!isUnavailableYoutubeVideo(video)) return video;
    }
  } catch {
    return null;
  }

  return null;
}

async function getYoutubeLiveFromLivePage() {
  const html = await fetchText(YOUTUBE_LIVE_URL);
  const ogUrl = matchOne(html, /<meta property="og:url" content="([^"]+)"/);
  const videoId = getVideoIdFromUrl(ogUrl);
  const isLive = /"isLiveContent":true|"liveBroadcastContent":"live"/.test(html);

  if (!videoId || !isLive) return null;

  const title = matchOne(html, /<meta property="og:title" content="([^"]+)"/) || "Join The Livestream";
  const thumbnail = matchOne(html, /<meta property="og:image" content="([^"]+)"/) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const watchUrl = normalizeWatchUrl(ogUrl, videoId);
  const video = {
    videoId,
    title,
    thumbnail,
    watchUrl,
    isLive: true,
    source: "youtube-live-page",
  };

  return isUnavailableYoutubeVideo(video) ? null : video;
}

function buildLivestreamResponse(video, source = "youtube-streams") {
  return {
    videoId: video?.videoId || "",
    title: video?.title || "Join The Livestream",
    date: video?.date || "",
    published: video?.published || "",
    description: video?.description || "",
    thumbnail: video?.thumbnail || "",
    watchUrl: video?.watchUrl || YOUTUBE_LIVE_URL,
    isLive: Boolean(video?.isLive),
    source: video?.source || source,
    channelUrl: YOUTUBE_CHANNEL_URL,
    liveUrl: YOUTUBE_LIVE_URL,
    fetchedAt: new Date().toISOString(),
  };
}

async function getYoutubeLive() {
  const now = Date.now();
  if (youtubeCache.live.data && youtubeCache.live.expires > now) {
    return youtubeCache.live.data;
  }

  try {
    const liveVideo =
      await getOfficialYoutubeBroadcast("live") ||
      await getYoutubeLiveFromLivePage();

    if (liveVideo) {
      const data = buildLivestreamResponse(liveVideo, "youtube-live");
      youtubeCache.live = { expires: now + YOUTUBE_CACHE_MS, data };
      return data;
    }

    const completedVideo =
      await getOfficialYoutubeBroadcast("completed") ||
      (await getYoutubeStreamsFromStreamsTab(1))[0];

    if (completedVideo) {
      const data = buildLivestreamResponse({ ...completedVideo, isLive: false }, "youtube-streams");
      youtubeCache.live = { expires: now + YOUTUBE_CACHE_MS, data };
      return data;
    }

    const [latestVideo] = await getYoutubeVideos(1);
    const data = buildLivestreamResponse({ ...latestVideo, isLive: false, source: "youtube-videos-fallback" }, "youtube-videos-fallback");
    youtubeCache.live = { expires: now + YOUTUBE_CACHE_MS, data };
    return data;
  } catch (error) {
    if (youtubeCache.live.data) return youtubeCache.live.data;
    const [latestVideo] = await getYoutubeVideos(1).catch(() => []);
    return buildLivestreamResponse({ ...latestVideo, isLive: false, source: "youtube-videos-fallback" }, "youtube-videos-fallback");
  }
}

async function handleApi(url, res) {
  if (url.pathname === "/api/youtube/videos") {
    const rawLimit = Number(url.searchParams.get("limit") || "8");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(12, rawLimit)) : 8;
    const videos = await getYoutubeVideos(limit);
    sendJson(res, 200, videos, "public, max-age=120");
    return true;
  }

  if (url.pathname === "/api/youtube/latest") {
    const live = await getYoutubeLive();
    sendJson(res, 200, live, "public, max-age=120");
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let urlPath = requestUrl.pathname;

  if (urlPath.startsWith("/api/")) {
    try {
      const handled = await handleApi(requestUrl, res);
      if (!handled) sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      sendJson(res, 502, { error: "YouTube data is temporarily unavailable" });
    }
    return;
  }

  if (urlPath === "/") {
    urlPath = "/index.html";
  }

  // Webflow exports store files with percent-encoded chars as literal filename
  // characters (e.g. the file on disk is literally "name%20(1).jpg", not "name (1).jpg").
  // Try the raw URL path first so those files resolve correctly, then fall back
  // to a fully-decoded path for any files that genuinely use spaces.
  let decoded = urlPath;
  try { decoded = decodeURIComponent(urlPath); } catch { /* keep raw */ }

  const candidates = [...new Set([urlPath, decoded])]
    .map(safeResolve)
    .filter(Boolean);

  if (candidates.length === 0) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  function tryNext(index) {
    if (index >= candidates.length) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found: " + urlPath);
      return;
    }
    const filePath = candidates[index];
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        tryNext(index + 1);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(filePath).pipe(res);
    });
  }

  tryNext(0);
});

server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`Static server running on port ${PORT}`);
});
