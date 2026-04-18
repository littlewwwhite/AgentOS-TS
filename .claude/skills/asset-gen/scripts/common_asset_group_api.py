#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common_asset_group_api.py - 资产组合管理 API 封装

封装 animeworkbench 平台的资产组合管理接口，供资产生成流程统一调用。

提供:
  list_asset_groups(name, page, page_size, group_ids)  -> {"data": [...], "total": N} | None
  get_asset_group(group_id)                            -> dict | None
  create_asset_group(name, description, project_name)  -> group_id | None
  update_asset_group(group_id, name, description)      -> bool
  create_asset(asset_groups_id, url, name, platform)   -> dict | None
  batch_import_third_assets(assets)                    -> bool
  list_third_assets(...)                               -> dict | None
"""

import json, sys
from pathlib import Path

# ── auth 模块（awb-login skill 提供）────────────────────────────────────
from common_config import get_shared_auth_path
sys.path.insert(0, str(get_shared_auth_path()))
import auth

# ── 平台常量 ────────────────────────────────────────────────────────────────
import os
BASE_URL = os.environ.get("AWB_BASE_URL", "https://animeworkbench.lingjingai.cn").rstrip("/")
ASSET_GROUP_PREFIX = f"{BASE_URL}/api/material/asset-groups"
ASSET_PREFIX = f"{BASE_URL}/api/material/assets"
THIRD_ASSET_PREFIX = f"{BASE_URL}/api/material/creation/thirdAsset"


DEFAULT_TIMEOUT = 60


def _post_json(url, payload, max_retries=3):
    """POST JSON 请求，返回解析后的响应 dict，失败返回 None。"""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    for attempt in range(1, max_retries + 1):
        try:
            result = auth.api_request(url, data=data, method="POST", timeout=DEFAULT_TIMEOUT)
            if result.get("code") == 200:
                return result
            print(f"  ⚠ 请求返回异常 (第{attempt}/{max_retries}次): code={result.get('code')}, msg={result.get('msg')}", flush=True)
        except Exception as e:
            print(f"  ⚠ 请求异常 (第{attempt}/{max_retries}次): {e}", flush=True)
        if attempt < max_retries:
            import time
            time.sleep(2)
    return None


# ═══════════════════════════════════════════════════════════════════════════
# 查询素材组合列表（list）
# POST /asset-groups/list
# ═══════════════════════════════════════════════════════════════════════════

def list_asset_groups(name="", page_number=1, page_size=20, group_ids=None):
    """
    查询素材组合列表（list 接口）。

    Args:
        name:        组合名称，模糊匹配（传空字符串查全部）
        page_number: 页码，从1开始，默认1
        page_size:   每页数量，范围1-100，默认20
        group_ids:   组合ID列表，精确匹配（可选）

    Returns:
        成功: 接口返回的 data 字段（通常为列表或分页对象）
        失败: None
    """
    payload = {
        "name": name,
        "pageNumber": page_number,
        "pageSize": page_size,
    }
    if group_ids:
        payload["groupIds"] = group_ids

    result = _post_json(f"{ASSET_GROUP_PREFIX}/list", payload)
    if result:
        print(f"  ✓ 查询素材组合列表成功", flush=True)
        return result.get("data")
    print(f"  ❌ 查询素材组合列表失败", flush=True)
    return None


# ═══════════════════════════════════════════════════════════════════════════
# 获取素材组合详情
# GET /asset-groups/{group_id}
# ═══════════════════════════════════════════════════════════════════════════

def get_asset_group(group_id):
    """
    获取素材组合详情。

    Args:
        group_id: 组合ID

    Returns:
        成功: 组合详情 dict
        失败: None
    """
    try:
        result = auth.api_request(
            f"{ASSET_GROUP_PREFIX}/{group_id}",
            method="GET",
            timeout=DEFAULT_TIMEOUT,
        )
        if result.get("code") == 200:
            print(f"  ✓ 获取素材组合详情成功: {group_id}", flush=True)
            return result.get("data")
        print(f"  ⚠ 获取素材组合详情失败: code={result.get('code')}, msg={result.get('msg')}", flush=True)
    except Exception as e:
        print(f"  ❌ 获取素材组合详情异常: {e}", flush=True)
    return None


# ═══════════════════════════════════════════════════════════════════════════
# 创建素材组合
# POST /asset-groups
# ═══════════════════════════════════════════════════════════════════════════

def create_asset_group(name, description="", project_name="default"):
    """
    创建素材组合。

    Args:
        name:         组合名称（必填，最多64字符）
        description:  组合描述（可选，最多300字符）
        project_name: 所属项目名称，默认 "default"

    Returns:
        成功: 接口返回的 data（通常为新组合ID）
        失败: None
    """
    payload = {
        "name": name,
        "projectName": project_name,
    }
    if description:
        payload["description"] = description

    result = _post_json(ASSET_GROUP_PREFIX, payload)
    if result:
        data = result.get("data")
        # data 可能是 dict（含 id 字段）或直接是 group_id 字符串
        if isinstance(data, dict):
            group_id = data.get("id")
        else:
            group_id = data
        print(f"  ✓ 创建素材组合成功: name={name}, group_id={group_id}", flush=True)
        return group_id
    print(f"  ❌ 创建素材组合失败: name={name}", flush=True)
    return None


# ═══════════════════════════════════════════════════════════════════════════
# 更新素材组合
# PUT /asset-groups/{group_id}
# ═══════════════════════════════════════════════════════════════════════════

def update_asset_group(group_id, name=None, description=None):
    """
    更新素材组合。

    Args:
        group_id:    组合ID
        name:        新的组合名称（可选，最多64字符）
        description: 新的组合描述（可选，最多300字符）

    Returns:
        成功: True
        失败: False
    """
    payload = {}
    if name is not None:
        payload["name"] = name
    if description is not None:
        payload["description"] = description

    if not payload:
        print(f"  ⚠ 更新素材组合: 未提供任何更新字段", flush=True)
        return False

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        result = auth.api_request(
            f"{ASSET_GROUP_PREFIX}/{group_id}",
            data=data,
            method="PUT",
            timeout=DEFAULT_TIMEOUT,
        )
        if result.get("code") == 200:
            print(f"  ✓ 更新素材组合成功: {group_id}", flush=True)
            return True
        print(f"  ⚠ 更新素材组合失败: code={result.get('code')}, msg={result.get('msg')}", flush=True)
    except Exception as e:
        print(f"  ❌ 更新素材组合异常: {e}", flush=True)
    return False


# ═══════════════════════════════════════════════════════════════════════════
# 创建素材资产
# POST /assets
# ═══════════════════════════════════════════════════════════════════════════

def create_asset(asset_groups_id, url, name, platform=""):
    """
    创建素材资产（绑定到指定组合）。

    Args:
        asset_groups_id: 所属素材组合 ID（必填）
        url:             资源路径（必填，COS 相对路径）
        name:            素材名称（必填，最多256字符）
        platform:        平台标识（选填，不传或空串默认 JIMENG）

    Returns:
        成功: 接口返回的 data
        失败: None
    """
    payload = {
        "assetGroupsId": asset_groups_id,
        "url": url,
        "name": name,
    }
    if platform:
        payload["platform"] = platform

    result = _post_json(ASSET_PREFIX, payload)
    if result:
        data = result.get("data")
        print(f"  ✓ 创建素材资产成功: name={name}", flush=True)
        return data
    print(f"  ❌ 创建素材资产失败: name={name}", flush=True)
    return None


# ═══════════════════════════════════════════════════════════════════════════
# CLI 入口 - 便于独立测试
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="资产组合管理 API 工具")
    sub = parser.add_subparsers(dest="command", help="子命令")

    # list
    p_list = sub.add_parser("list", help="查询素材组合列表")
    p_list.add_argument("--name", default="", help="组合名称（模糊匹配）")
    p_list.add_argument("--page", type=int, default=1, help="页码")
    p_list.add_argument("--size", type=int, default=20, help="每页数量")
    p_list.add_argument("--ids", nargs="*", help="组合ID列表")

    # query
    p_query = sub.add_parser("query", help="查询素材组合列表(query)")
    p_query.add_argument("--name", default="", help="组合名称（模糊匹配）")
    p_query.add_argument("--page", type=int, default=1, help="页码")
    p_query.add_argument("--size", type=int, default=20, help="每页数量")
    p_query.add_argument("--ids", nargs="*", help="组合ID列表")

    # get
    p_get = sub.add_parser("get", help="获取素材组合详情")
    p_get.add_argument("group_id", help="组合ID")

    # create
    p_create = sub.add_parser("create", help="创建素材组合")
    p_create.add_argument("--name", required=True, help="组合名称")
    p_create.add_argument("--desc", default="", help="组合描述")
    p_create.add_argument("--project", default="default", help="项目名称")

    # update
    p_update = sub.add_parser("update", help="更新素材组合")
    p_update.add_argument("group_id", help="组合ID")
    p_update.add_argument("--name", help="新的组合名称")
    p_update.add_argument("--desc", help="新的组合描述")

    # create-asset
    p_asset = sub.add_parser("create-asset", help="创建素材资产")
    p_asset.add_argument("--group-id", required=True, help="所属组合ID")
    p_asset.add_argument("--url", required=True, help="资源路径（COS 相对路径）")
    p_asset.add_argument("--name", required=True, help="素材名称")
    p_asset.add_argument("--platform", default="", help="平台标识（默认 JIMENG）")

    args = parser.parse_args()

    if args.command == "list":
        data = list_asset_groups(args.name, args.page, args.size, args.ids)
        print(json.dumps(data, ensure_ascii=False, indent=2))

    elif args.command == "get":
        data = get_asset_group(args.group_id)
        print(json.dumps(data, ensure_ascii=False, indent=2))

    elif args.command == "create":
        data = create_asset_group(args.name, args.desc, args.project)
        print(json.dumps(data, ensure_ascii=False, indent=2) if data else "创建失败")

    elif args.command == "update":
        ok = update_asset_group(args.group_id, args.name, args.desc)
        print("更新成功" if ok else "更新失败")

    elif args.command == "create-asset":
        data = create_asset(args.group_id, args.url, args.name, args.platform)
        print(json.dumps(data, ensure_ascii=False, indent=2) if data else "创建失败")

    else:
        parser.print_help()
