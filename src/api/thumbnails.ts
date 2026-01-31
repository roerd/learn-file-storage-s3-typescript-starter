import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo,updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const MAX_UPLOAD_SIZE = 10 << 20; // 10 MB

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file too large");
  }

  const mediaType = file.type;
  if (!["image/jpeg", "image/png"].includes(mediaType)) {
    throw new BadRequestError("Unsupported thumbnail file type");
  }
  const fileExtension = mediaType.split("/")[1];
  const randomBytesBuffer = randomBytes(32);
  const baseFileName = randomBytesBuffer.toString("base64url");
  const filePath = path.join(cfg.assetsRoot, `${baseFileName}.${fileExtension}`);

  const fileData = await file.arrayBuffer();
  Bun.write(filePath, fileData);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video in the database");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("You do not have permission to modify this video");
  }

  const url = `http://localhost:8091/assets/${baseFileName}.${fileExtension}`;
  video.thumbnailURL = url;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
