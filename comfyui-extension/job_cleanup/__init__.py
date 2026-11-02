"""Comfy cleanup: POST /job-cleanup deletes the files a finished job left in ComfyUI.

ComfyUI has no delete API. This registers one narrow route; see README.md. Disabled (503) unless
JOB_CLEANUP_TOKEN is set on the ComfyUI process.
"""

import asyncio
import logging
import os

import folder_paths
from aiohttp import web
from server import PromptServer

from .safe_paths import MIN_TOKEN_LENGTH, delete_files, token_matches

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

log = logging.getLogger("job_cleanup")


def _roots():
    return {
        "output": folder_paths.get_output_directory(),
        "temp": folder_paths.get_temp_directory(),
        "input": folder_paths.get_input_directory(),
    }


@PromptServer.instance.routes.post("/job-cleanup")
async def job_cleanup(request: web.Request) -> web.Response:
    token = os.environ.get("JOB_CLEANUP_TOKEN", "").strip()
    if len(token) < MIN_TOKEN_LENGTH:
        return web.json_response({"error": "cleanup disabled"}, status=503)
    if not token_matches(token, request.headers.get("Authorization", "")):
        return web.json_response({"error": "unauthorized"}, status=401)
    try:
        body = await request.json()
        files = body.get("files") if isinstance(body, dict) else None
        loop = asyncio.get_running_loop()
        counts = await loop.run_in_executor(None, delete_files, files, _roots())
    except ValueError:
        return web.json_response({"error": "bad request"}, status=400)
    except Exception as err:
        log.error("job cleanup failed (%s)", type(err).__name__)
        return web.json_response({"error": "cleanup failed"}, status=500)
    log.info(
        "job cleanup: deleted=%d missing=%d refused=%d",
        counts["deleted"], counts["missing"], counts["refused"],
    )
    return web.json_response(counts)
