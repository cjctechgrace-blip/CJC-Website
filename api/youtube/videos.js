import { getYoutubeVideos, sendJson } from "./_shared.js";

export default async function handler(req, res) {
  try {
    const rawLimit = Number(req.query.limit || "8");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(12, rawLimit)) : 8;
    const videos = await getYoutubeVideos(limit);
    sendJson(res, 200, videos);
  } catch {
    sendJson(res, 502, { error: "YouTube data is temporarily unavailable" }, "no-cache");
  }
}
