"""GardenDoc — plant / lawn / tree diagnostic app.

Snap a photo of a plant, a patch of lawn, or a tree and get an instant,
structured diagnosis: what it is, what's wrong (overwatering, underwatering,
nutrient deficiencies such as iron or nitrogen, disease, pests...) and a
concrete action plan to fix it.

Run:
    export ANTHROPIC_API_KEY=sk-ant-...
    pip install -r requirements.txt
    python app.py

Then open http://<your-ip>:5050 from your phone (same network) and use
"Add to Home Screen" to install it as an app.
"""

import base64
import binascii
import json
import os
import re

import anthropic
from flask import Flask, jsonify, render_template, request, send_from_directory

app = Flask(__name__)

MODEL = os.environ.get("GARDENDOC_MODEL", "claude-opus-4-8")
MAX_IMAGE_BYTES = 20 * 1024 * 1024

ALLOWED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

# Structured-output schema: guarantees the model returns valid JSON the UI
# can render directly (no free-text parsing).
DIAGNOSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "subject_type": {
            "type": "string",
            "enum": ["plant", "lawn", "tree", "unknown"],
        },
        "identification": {
            "type": "object",
            "properties": {
                "common_name": {"type": "string"},
                "scientific_name": {"type": "string"},
                "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            },
            "required": ["common_name", "scientific_name", "confidence"],
            "additionalProperties": False,
        },
        "health_status": {
            "type": "string",
            "enum": ["healthy", "minor_issues", "moderate_issues", "severe_issues", "dying_or_dead"],
        },
        "summary": {
            "type": "string",
            "description": "2-3 sentence plain-language verdict the gardener reads first.",
        },
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "category": {
                        "type": "string",
                        "enum": [
                            "overwatering",
                            "underwatering",
                            "nutrient_deficiency",
                            "disease",
                            "pest",
                            "sunlight",
                            "soil",
                            "temperature_stress",
                            "mowing_or_pruning",
                            "other",
                        ],
                    },
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "evidence": {
                        "type": "string",
                        "description": "What in the photo indicates this issue.",
                    },
                    "nutrient": {
                        "type": ["string", "null"],
                        "description": "If nutrient_deficiency: which nutrient (e.g. iron, nitrogen, magnesium), else null.",
                    },
                },
                "required": ["name", "category", "severity", "evidence", "nutrient"],
                "additionalProperties": False,
            },
        },
        "immediate_actions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Ordered, concrete steps to take now (products, amounts, frequency where possible).",
        },
        "ongoing_care": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Care routine for the next weeks: watering schedule, feeding, light, mowing height, etc.",
        },
        "watering_verdict": {
            "type": "string",
            "enum": ["too_much_water", "too_little_water", "watering_ok", "cannot_tell"],
        },
        "prevention_tips": {"type": "array", "items": {"type": "string"}},
        "photo_quality_note": {
            "type": ["string", "null"],
            "description": "If a better photo would improve the diagnosis, say what to photograph; else null.",
        },
    },
    "required": [
        "subject_type",
        "identification",
        "health_status",
        "summary",
        "issues",
        "immediate_actions",
        "ongoing_care",
        "watering_verdict",
        "prevention_tips",
        "photo_quality_note",
    ],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """\
You are GardenDoc, an expert horticulturist, arborist, turf-grass specialist and
plant pathologist helping a home gardener diagnose problems from photos.

Analyze the photo carefully:
- Identify the plant / grass / tree as precisely as the photo allows.
- Look for symptoms: leaf color patterns (interveinal chlorosis -> iron/magnesium,
  uniform yellowing of older leaves -> nitrogen, browning tips, purpling -> phosphorus),
  wilting, leaf drop, fungal spots, powdery coatings, rust, thatch, bare or yellow
  lawn patches, dollar spot, brown patch, grubs/pest damage, scorch, root rot signs,
  over/underwatering signs, mower scalping, compaction, etc.
- Distinguish overwatering (yellow + limp leaves, soggy soil, fungus gnats, root rot smell)
  from underwatering (crispy brown edges, dry pulling-away soil, wilt that recovers after water).
- Be honest about uncertainty: if the photo can't support a firm diagnosis, lower the
  identification confidence, use "cannot_tell" for the watering verdict, and use
  photo_quality_note to ask for a better shot (e.g. close-up of a leaf underside,
  wider shot of the lawn patch, soil surface).
- Make actions concrete and doable by a home gardener: name the type of product
  (e.g. "chelated iron foliar spray", "balanced 10-10-10 fertilizer", "neem oil"),
  rough amounts, and frequency. Consider the user's notes and the season if given.
- If the plant is healthy, say so plainly and keep issues empty.
"""


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory(app.static_folder, "manifest.json")


@app.route("/sw.js")
def service_worker():
    return send_from_directory(app.static_folder, "sw.js", mimetype="application/javascript")


@app.route("/api/diagnose", methods=["POST"])
def diagnose():
    payload = request.get_json(silent=True) or {}
    data_url = payload.get("image", "")
    category = payload.get("category", "auto")
    notes = (payload.get("notes") or "").strip()

    match = re.match(r"^data:(image/[a-z+.-]+);base64,(.+)$", data_url, re.DOTALL)
    if not match:
        return jsonify({"error": "Missing or invalid image. Expected a base64 data URL."}), 400

    media_type, b64_data = match.group(1), match.group(2)
    if media_type not in ALLOWED_MEDIA_TYPES:
        return jsonify({"error": f"Unsupported image type {media_type}."}), 400
    try:
        raw = base64.b64decode(b64_data, validate=True)
    except (binascii.Error, ValueError):
        return jsonify({"error": "Image data is not valid base64."}), 400
    if len(raw) > MAX_IMAGE_BYTES:
        return jsonify({"error": "Image too large (max 20 MB). Try a smaller photo."}), 400

    user_text = "Diagnose what you see in this photo of my garden."
    if category in ("plant", "lawn", "tree"):
        user_text = f"Diagnose this {category} from my garden."
    if notes:
        user_text += f"\n\nMy notes / what I've observed: {notes}"
    user_text += "\n\nReturn the diagnosis in the required JSON format."

    try:
        response = _client().messages.create(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=SYSTEM_PROMPT,
            output_config={
                "format": {"type": "json_schema", "schema": DIAGNOSIS_SCHEMA}
            },
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64_data,
                            },
                        },
                        {"type": "text", "text": user_text},
                    ],
                }
            ],
        )
    except (anthropic.AuthenticationError, TypeError):
        # TypeError: the SDK raises it at request-build time when no
        # credentials are configured at all (no ANTHROPIC_API_KEY etc.).
        return jsonify({"error": "Server is missing a valid ANTHROPIC_API_KEY."}), 500
    except anthropic.BadRequestError as exc:
        return jsonify({"error": f"The AI service rejected the request: {exc.message}"}), 502
    except anthropic.RateLimitError:
        return jsonify({"error": "Rate limited by the AI service. Wait a minute and retry."}), 429
    except anthropic.APIStatusError as exc:
        return jsonify({"error": f"AI service error ({exc.status_code}). Try again."}), 502
    except anthropic.APIConnectionError:
        return jsonify({"error": "Could not reach the AI service. Check the server's network."}), 502

    if response.stop_reason == "refusal":
        return jsonify({"error": "The AI declined to analyze this image. Try a different photo."}), 422

    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        return jsonify({"error": "The AI returned no diagnosis. Try again."}), 502
    try:
        diagnosis = json.loads(text)
    except json.JSONDecodeError:
        return jsonify({"error": "The AI returned an unreadable diagnosis. Try again."}), 502

    return jsonify({"diagnosis": diagnosis, "model": response.model})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    app.run(host="0.0.0.0", port=port, debug=False)
