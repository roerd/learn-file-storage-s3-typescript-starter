import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { randomBytes } from "crypto";

const MAX_UPLOAD_SIZE = 1 << 30; // 1 GB

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video", videoId, "by user", userID);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video in the database");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("You do not have permission to modify this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video file too large");
  }

  const mediaType = file.type;
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Unsupported video file type");
  }

  const arrayBuffer = await file.arrayBuffer();
  const temporaryFilePath = `/tmp/${videoId}.mp4`;
  await Bun.write(temporaryFilePath, arrayBuffer);

  const randomBytesBuffer = randomBytes(32);
  const baseFileName = randomBytesBuffer.toString("base64url");
  const s3Key = `${baseFileName}.mp4`;
  const fileContent = Bun.file(temporaryFilePath);
  
  await cfg.s3Client.file(s3Key).write(fileContent, {type: mediaType});

  await Bun.file(temporaryFilePath).delete();
  
  const url = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`;
  video.videoURL = url;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, null);
}
