import { getYoutubeLatest, sendJson } from "./_shared.js";

export default async function handler(req, res) {
  try {
    const latest = await getYoutubeLatest();
    sendJson(res, 200, latest);
  } catch {
    sendJson(res, 502, { error: "YouTube data is temporarily unavailable" }, "no-cache");
  }
}
