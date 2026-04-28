#!/usr/bin/env python3
# input: output/script.json actor states plus output/actors/actors.json state assets
# output: subject mapping aliases keyed by stable @act_xxx:st_yyy ids
# pos: regression coverage for VIDEO state-token reference image resolution
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))


def test_load_assets_mapping_creates_state_aliases_from_script_state_names(tmp_path):
    from batch_generate import load_assets_subject_mapping

    output = tmp_path / "output"
    actors_dir = output / "actors"
    actors_dir.mkdir(parents=True)
    (output / "script.json").write_text(
        json.dumps(
            {
                "actors": [
                    {
                        "actor_id": "act_001",
                        "actor_name": "Rosalind",
                        "states": [
                            {
                                "state_id": "st_001",
                                "state_name": "Laundry Slave Attire",
                            }
                        ],
                    }
                ],
                "episodes": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (actors_dir / "actors.json").write_text(
        json.dumps(
            {
                "act_001": {
                    "name": "Rosalind",
                    "default": {
                        "subject_id": "base",
                        "three_view_url": "https://example.test/base.png",
                    },
                    "Laundry Slave Attire": {
                        "subject_id": "state",
                        "three_view_url": "https://example.test/state.png",
                    },
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    mapping = load_assets_subject_mapping(str(output))

    assert mapping["act_001"]["subject_id"] == "base"
    assert mapping["act_001:st_001"]["subject_id"] == "state"
    assert mapping["act_001:st_001"]["image_url"] == "https://example.test/state.png"


def test_asset_registry_overrides_actor_state_with_ark_asset_uri(tmp_path):
    from batch_generate import load_assets_subject_mapping

    output = tmp_path / "output"
    actors_dir = output / "actors"
    actors_dir.mkdir(parents=True)
    (output / "script.json").write_text(
        json.dumps(
            {
                "actors": [
                    {
                        "actor_id": "act_001",
                        "actor_name": "Rosalind",
                        "states": [
                            {
                                "state_id": "st_001",
                                "state_name": "Laundry Slave Attire",
                            }
                        ],
                    }
                ],
                "episodes": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (actors_dir / "actors.json").write_text(
        json.dumps(
            {
                "act_001": {
                    "name": "Rosalind",
                    "Laundry Slave Attire": {
                        "subject_id": "generated-state",
                        "three_view_url": "https://example.test/state.png",
                    },
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (output / "asset_registry.json").write_text(
        json.dumps(
            {
                "schema_version": "ark-asset-registry/v1",
                "actors": {
                    "act_001": {
                        "states": {
                            "st_001": "asset-20260222234430-mxpgh",
                        }
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    mapping = load_assets_subject_mapping(str(output))

    assert mapping["act_001:st_001"]["image_url"] == "asset://asset-20260222234430-mxpgh"
    assert mapping["act_001:st_001"]["asset_uri"] == "asset://asset-20260222234430-mxpgh"
    assert mapping["act_001:st_001"]["trusted_asset"] is True
