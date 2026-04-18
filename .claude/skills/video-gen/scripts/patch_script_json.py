#!/usr/bin/env python3
# input: script.json path + patch data (CLI args or batch file)
# output: modified script.json (atomic write with file locking)
# pos: Director helper — enables incremental script.json patching without loading full file into LLM context

import argparse
import fcntl
import json
import os
import sys
import tempfile


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def atomic_write(path: str, data: dict) -> None:
    dir_ = os.path.dirname(os.path.abspath(path))
    fd, tmp_path = tempfile.mkstemp(dir=dir_, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.rename(tmp_path, path)
    except Exception:
        os.unlink(tmp_path)
        raise


def index_by(items: list, key: str) -> dict:
    """Build id->item index for a list of entity dicts."""
    return {item[key]: item for item in items if key in item}


def merge_patch(target: dict, patch: dict, force: bool) -> list[str]:
    """Merge patch into target. Returns list of skipped keys (existing, no --force)."""
    skipped = []
    for k, v in patch.items():
        if k in target and not force:
            skipped.append(k)
        else:
            target[k] = v
    return skipped


def apply_entity_patch(
    script: dict,
    collection_key: str,
    id_field: str,
    entity_id: str,
    patch: dict,
    force: bool,
) -> int:
    collection = script.get(collection_key, [])
    idx = index_by(collection, id_field)
    if entity_id not in idx:
        print(
            f"ERROR: {collection_key[:-1]} '{entity_id}' not found in script",
            file=sys.stderr,
        )
        sys.exit(1)
    skipped = merge_patch(idx[entity_id], patch, force)
    if skipped:
        print(
            f"WARNING: skipped existing keys {skipped} on {entity_id} (use --force to overwrite)",
            file=sys.stderr,
        )
    return 1


def apply_batch(script: dict, batch: dict, force: bool) -> tuple[int, int, int]:
    """Apply batch patches. Returns (n_actors, n_locations, n_scenes) patched."""
    ENTITY_MAP = [
        ("actors", "actor_id"),
        ("locations", "location_id"),
        ("scenes", "scene_id"),
    ]
    counts = []
    for collection_key, id_field in ENTITY_MAP:
        section = batch.get(collection_key, {})
        n = 0
        for entity_id, patch in section.items():
            apply_entity_patch(script, collection_key, id_field, entity_id, patch, force)
            n += 1
        counts.append(n)
    return tuple(counts)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Incrementally patch script.json without loading it into LLM context."
    )
    parser.add_argument("--script", required=True, help="Path to script.json")
    parser.add_argument(
        "--force", action="store_true", help="Overwrite existing fields"
    )

    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--patch-actor", metavar="ACTOR_ID", help="Target actor id")
    mode.add_argument(
        "--patch-location", metavar="LOCATION_ID", help="Target location id"
    )
    mode.add_argument("--patch-scene", metavar="SCENE_ID", help="Target scene id")
    mode.add_argument("--batch", metavar="PATCHES_JSON", help="Path to batch patches file")

    parser.add_argument(
        "--set",
        metavar="JSON",
        help="JSON object of fields to set (required for single-entity modes)",
    )

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # Validate --set required for single-entity modes
    single_modes = (args.patch_actor, args.patch_location, args.patch_scene)
    if any(single_modes) and not args.set:
        print("ERROR: --set is required when using --patch-actor/location/scene", file=sys.stderr)
        sys.exit(1)

    # Parse --set if provided
    patch_data: dict | None = None
    if args.set:
        try:
            patch_data = json.loads(args.set)
            if not isinstance(patch_data, dict):
                raise ValueError("--set must be a JSON object")
        except (json.JSONDecodeError, ValueError) as e:
            print(f"ERROR: invalid --set JSON: {e}", file=sys.stderr)
            sys.exit(1)

    script_path = os.path.abspath(args.script)
    if not os.path.isfile(script_path):
        print(f"ERROR: script file not found: {script_path}", file=sys.stderr)
        sys.exit(1)

    # Open with exclusive lock for the entire read-modify-write cycle
    with open(script_path, "r+", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh, fcntl.LOCK_EX)
        try:
            script = json.load(lock_fh)
        except json.JSONDecodeError as e:
            print(f"ERROR: invalid JSON in {script_path}: {e}", file=sys.stderr)
            sys.exit(1)

        n_actors = n_locations = n_scenes = 0

        if args.batch:
            batch_path = os.path.abspath(args.batch)
            try:
                batch = load_json(batch_path)
            except (OSError, json.JSONDecodeError) as e:
                print(f"ERROR: cannot load batch file '{batch_path}': {e}", file=sys.stderr)
                sys.exit(1)
            n_actors, n_locations, n_scenes = apply_batch(script, batch, args.force)
        elif args.patch_actor:
            n_actors = apply_entity_patch(
                script, "actors", "actor_id", args.patch_actor, patch_data, args.force
            )
        elif args.patch_location:
            n_locations = apply_entity_patch(
                script, "locations", "location_id", args.patch_location, patch_data, args.force
            )
        elif args.patch_scene:
            n_scenes = apply_entity_patch(
                script, "scenes", "scene_id", args.patch_scene, patch_data, args.force
            )

        atomic_write(script_path, script)
        # Lock released when context manager exits

    parts = []
    if n_actors:
        parts.append(f"{n_actors} actor{'s' if n_actors != 1 else ''}")
    if n_locations:
        parts.append(f"{n_locations} location{'s' if n_locations != 1 else ''}")
    if n_scenes:
        parts.append(f"{n_scenes} scene{'s' if n_scenes != 1 else ''}")

    if parts:
        print(f"patched {', '.join(parts)}")
    else:
        print("nothing patched")


if __name__ == "__main__":
    main()
