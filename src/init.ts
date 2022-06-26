import { Module } from "./modules/module";
import { vnode, VNode } from "./vnode";
import * as is from "./is";
import { htmlDomApi, DOMAPI } from "./htmldomapi";

type NonUndefined<T> = T extends undefined ? never : T;

function isUndef(s: any): boolean {
  return s === undefined;
}
function isDef<A>(s: A): s is NonUndefined<A> {
  return s !== undefined;
}

type VNodeQueue = VNode[];

const emptyNode = vnode("", {}, [], undefined, undefined);

function sameVnode(vnode1: VNode, vnode2: VNode): boolean {
  const isSameKey = vnode1.key === vnode2.key;
  const isSameIs = vnode1.data?.is === vnode2.data?.is;
  const isSameSel = vnode1.sel === vnode2.sel;
  const isSameTextOrFragment =
    !vnode1.sel && vnode1.sel === vnode2.sel
      ? typeof vnode1.text === typeof vnode2.text
      : true;

  return isSameSel && isSameKey && isSameIs && isSameTextOrFragment;
}

/**
 * @todo Remove this function when the document fragment is considered stable.
 */
function documentFragmentIsNotSupported(): never {
  throw new Error("The document fragment is not supported on this platform.");
}

function isElement(
  api: DOMAPI,
  vnode: Element | DocumentFragment | VNode
): vnode is Element {
  return api.isElement(vnode as any);
}

function isDocumentFragment(
  api: DOMAPI,
  vnode: DocumentFragment | VNode
): vnode is DocumentFragment {
  return api.isDocumentFragment!(vnode as any);
}

type KeyToIndexMap = { [key: string]: number };

type ArraysOf<T> = {
  [K in keyof T]: Array<T[K]>;
};

type ModuleHooks = ArraysOf<Required<Module>>;

function createKeyToOldIdx(
  children: VNode[],
  beginIdx: number,
  endIdx: number
): KeyToIndexMap {
  const map: KeyToIndexMap = {};
  for (let i = beginIdx; i <= endIdx; ++i) {
    const key = children[i]?.key;
    if (key !== undefined) {
      map[key as string] = i;
    }
  }
  return map;
}

const hooks: Array<keyof Module> = [
  "create",
  "update",
  "remove",
  "destroy",
  "pre",
  "post",
];

// TODO Should `domApi` be put into this in the next major version bump?
export type Options = {
  experimental?: {
    fragments?: boolean;
  };
};

export function init(
  modules: Array<Partial<Module>>,
  domApi?: DOMAPI,
  options?: Options
) {

  const cbs: ModuleHooks = {
    create: [],
    update: [],
    remove: [],
    destroy: [],
    pre: [],
    post: [],
  };

  const api: DOMAPI = domApi !== undefined ? domApi : htmlDomApi;

  // 按照定义好的名称 把传入的hooks分别放进指定的位置
  for (const hook of hooks) {
    for (const module of modules) {
      const currentHook = module[hook];
      if (currentHook !== undefined) {
        (cbs[hook] as any[]).push(currentHook);
      }
    }
  }

  function emptyNodeAt(elm: Element) {
    const id = elm.id ? "#" + elm.id : "";

    // elm.className doesn't return a string when elm is an SVG element inside a shadowRoot.
    // https://stackoverflow.com/questions/29454340/detecting-classname-of-svganimatedstring
    const classes = elm.getAttribute("class");

    const c = classes ? "." + classes.split(" ").join(".") : "";
    return vnode(
      api.tagName(elm).toLowerCase() + id + c,
      {},
      [],
      undefined,
      elm
    );
  }

  function emptyDocumentFragmentAt(frag: DocumentFragment) {
    return vnode(undefined, {}, [], undefined, frag);
  }

  function createRmCb(childElm: Node, listeners: number) {
    return function rmCb() {
      if (--listeners === 0) {
        const parent = api.parentNode(childElm) as Node;
        api.removeChild(parent, childElm);
      }
    };
  }

  // 递归创建 elm
  function createElm(vnode: VNode, insertedVnodeQueue: VNodeQueue): Node {
    let i: any;
    let data = vnode.data;
    if (data !== undefined) {
      const init = data.hook?.init;
      if (isDef(init)) {
        init(vnode);
        data = vnode.data;
      }
    }
    const children = vnode.children;
    const sel = vnode.sel;
    if (sel === "!") {
      if (isUndef(vnode.text)) {
        vnode.text = "";
      }
      vnode.elm = api.createComment(vnode.text!);
    } else if (sel !== undefined) {
      // Parse selector
      const hashIdx = sel.indexOf("#");
      const dotIdx = sel.indexOf(".", hashIdx);
      const hash = hashIdx > 0 ? hashIdx : sel.length;
      const dot = dotIdx > 0 ? dotIdx : sel.length;
      const tag =
        hashIdx !== -1 || dotIdx !== -1
          ? sel.slice(0, Math.min(hash, dot))
          : sel;
      const elm = (vnode.elm =
        isDef(data) && isDef((i = data.ns))
          ? api.createElementNS(i, tag, data)
          : api.createElement(tag, data));
      if (hash < dot) elm.setAttribute("id", sel.slice(hash + 1, dot));
      if (dotIdx > 0)
        elm.setAttribute("class", sel.slice(dot + 1).replace(/\./g, " "));
      for (i = 0; i < cbs.create.length; ++i) cbs.create[i](emptyNode, vnode);
      if (is.array(children)) {
        for (i = 0; i < children.length; ++i) {
          const ch = children[i];
          if (ch != null) {
            api.appendChild(elm, createElm(ch as VNode, insertedVnodeQueue));
          }
        }
      } else if (is.primitive(vnode.text)) {
        api.appendChild(elm, api.createTextNode(vnode.text));
      }
      const hook = vnode.data!.hook;
      if (isDef(hook)) {
        hook.create?.(emptyNode, vnode);
        if (hook.insert) {
          insertedVnodeQueue.push(vnode);
        }
      }
    } else if (options?.experimental?.fragments && vnode.children) {
      vnode.elm = (
        api.createDocumentFragment ?? documentFragmentIsNotSupported
      )();
      for (i = 0; i < cbs.create.length; ++i) cbs.create[i](emptyNode, vnode);
      for (i = 0; i < vnode.children.length; ++i) {
        const ch = vnode.children[i];
        if (ch != null) {
          api.appendChild(
            vnode.elm,
            createElm(ch as VNode, insertedVnodeQueue)
          );
        }
      }
    } else {
      vnode.elm = api.createTextNode(vnode.text!);
    }
    return vnode.elm;
  }

  function addVnodes(
    parentElm: Node,
    before: Node | null,
    vnodes: VNode[],
    startIdx: number,
    endIdx: number,
    insertedVnodeQueue: VNodeQueue
  ) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx];
      if (ch != null) {
        api.insertBefore(parentElm, createElm(ch, insertedVnodeQueue), before);
      }
    }
  }

  function invokeDestroyHook(vnode: VNode) {
    const data = vnode.data;
    if (data !== undefined) {
      data?.hook?.destroy?.(vnode);
      for (let i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
      if (vnode.children !== undefined) {
        for (let j = 0; j < vnode.children.length; ++j) {
          const child = vnode.children[j];
          if (child != null && typeof child !== "string") {
            invokeDestroyHook(child);
          }
        }
      }
    }
  }

  function removeVnodes(
    parentElm: Node,
    vnodes: VNode[],
    startIdx: number,
    endIdx: number
  ): void {
    for (; startIdx <= endIdx; ++startIdx) {
      let listeners: number;
      let rm: () => void;
      const ch = vnodes[startIdx];
      if (ch != null) {
        if (isDef(ch.sel)) {
          invokeDestroyHook(ch);
          listeners = cbs.remove.length + 1;
          rm = createRmCb(ch.elm!, listeners);
          for (let i = 0; i < cbs.remove.length; ++i) cbs.remove[i](ch, rm);
          const removeHook = ch?.data?.hook?.remove;
          if (isDef(removeHook)) {
            removeHook(ch, rm);
          } else {
            rm();
          }
        } else if (ch.children) {
          // Fragment node
          invokeDestroyHook(ch);
          removeVnodes(
            parentElm,
            ch.children as VNode[],
            0,
            ch.children.length - 1
          );
        } else {
          // Text node
          api.removeChild(parentElm, ch.elm!);
        }
      }
    }
  }

  function updateChildren(
    parentElm: Node,
    oldCh: VNode[],
    newCh: VNode[],
    insertedVnodeQueue: VNodeQueue
  ) {
    // 旧children 开始结束 索引和节点
    let oldStartIdx = 0;
    let oldEndIdx = oldCh.length - 1;
    let oldStartVnode = oldCh[0];
    let oldEndVnode = oldCh[oldEndIdx];

    // 新children 开始结束 索引和节点
    let newStartIdx = 0;
    let newEndIdx = newCh.length - 1;
    let newStartVnode = newCh[0];
    let newEndVnode = newCh[newEndIdx];

    let oldKeyToIdx: KeyToIndexMap | undefined;
    let idxInOld: number;
    let elmToMove: VNode;
    let before: any;

    // 两个children的开始结束索引 其中一个children碰撞时结束对比
    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      // 开始 结束 索引往中间移动
      if (oldStartVnode == null) {
        oldStartVnode = oldCh[++oldStartIdx]; // Vnode might have been moved left
      } else if (oldEndVnode == null) {
        oldEndVnode = oldCh[--oldEndIdx];
      } else if (newStartVnode == null) {
        newStartVnode = newCh[++newStartIdx];
      } else if (newEndVnode == null) {
        newEndVnode = newCh[--newEndIdx];

        // 对比 开始-开始 相同
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        // 对比下一级
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue);
        // 索引++
        oldStartVnode = oldCh[++oldStartIdx];
        newStartVnode = newCh[++newStartIdx];

        // 对比 结束-结束 相同
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        // 对比 下一级
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue);

        oldEndVnode = oldCh[--oldEndIdx];
        newEndVnode = newCh[--newEndIdx];

        // 对比 旧ch开始-新结束 相同
      } else if (sameVnode(oldStartVnode, newEndVnode)) {
        // // 对比下一级
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue);

        // 新的节点=旧节点，不需要再创建，把新节点（旧节点同个节点）插入到 旧children结束节点位置
        // Vnode moved right
        api.insertBefore(
          parentElm,
          oldStartVnode.elm!,
          api.nextSibling(oldEndVnode.elm!)
        );


        oldStartVnode = oldCh[++oldStartIdx];
        newEndVnode = newCh[--newEndIdx];

        // 对比 新ch开始-旧结束 相同
      } else if (sameVnode(oldEndVnode, newStartVnode)) {
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue);
        // Vnode moved left
        api.insertBefore(parentElm, oldEndVnode.elm!, oldStartVnode.elm!);
        oldEndVnode = oldCh[--oldEndIdx];
        newStartVnode = newCh[++newStartIdx];
      } else {
        // 前前 后后  前后 后前 都没命中
        if (oldKeyToIdx === undefined) {
          // key 对应index
          oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);
        }

        // 开始新节点在 旧的children中索引
        idxInOld = oldKeyToIdx[newStartVnode.key as string];

        // 开始新节点 存在旧的children中
        if (isUndef(idxInOld)) {
          // New element
          api.insertBefore(
            parentElm,
            createElm(newStartVnode, insertedVnodeQueue),
            oldStartVnode.elm!
          );
        } else {
          // 新节点不在旧children中
          elmToMove = oldCh[idxInOld];
          if (elmToMove.sel !== newStartVnode.sel) {
            api.insertBefore(
              parentElm,
              createElm(newStartVnode, insertedVnodeQueue),
              oldStartVnode.elm!
            );
          } else {
            patchVnode(elmToMove, newStartVnode, insertedVnodeQueue);
            oldCh[idxInOld] = undefined as any;
            api.insertBefore(parentElm, elmToMove.elm!, oldStartVnode.elm!);
          }
        }
        newStartVnode = newCh[++newStartIdx];
      }
    }

    // 如果对比结束之后 添加未对比的新节点
    if (newStartIdx <= newEndIdx) {
      before = newCh[newEndIdx + 1] == null ? null : newCh[newEndIdx + 1].elm;
      addVnodes(
        parentElm,
        before,
        newCh,
        newStartIdx,
        newEndIdx,
        insertedVnodeQueue
      );
    }
    // 如果对比结束之后, 移除剩余未对比的旧节点
    if (oldStartIdx <= oldEndIdx) {
      removeVnodes(parentElm, oldCh, oldStartIdx, oldEndIdx);
    }
  }

  function patchVnode(
    oldVnode: VNode,
    vnode: VNode,
    insertedVnodeQueue: VNodeQueue
  ) {
    const hook = vnode.data?.hook;
    hook?.prepatch?.(oldVnode, vnode);


    const elm = (vnode.elm = oldVnode.elm)!;

    // 完全一致，不需要更新
    if (oldVnode === vnode) return;

    // children 是text
    if (
      vnode.data !== undefined ||
      (isDef(vnode.text) && vnode.text !== oldVnode.text)
    ) {
      vnode.data ??= {};
      oldVnode.data ??= {};
      for (let i = 0; i < cbs.update.length; ++i)
        cbs.update[i](oldVnode, vnode);
      vnode.data?.hook?.update?.(oldVnode, vnode);
    }


    const oldCh = oldVnode.children as VNode[];
    const ch = vnode.children as VNode[];

    // text为undefined, 则children为 Array<VNodeChildElement>
    if (isUndef(vnode.text)) {
      // 都有children
      if (isDef(oldCh) && isDef(ch)) {
        // 对比更新children
        if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue);
        // 新children有，旧children无
      } else if (isDef(ch)) {
        // 旧children无，一般旧children是text
        if (isDef(oldVnode.text)) api.setTextContent(elm, "");

        // 添加新children
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue);
        // 旧children有，新children无
      } else if (isDef(oldCh)) {
        // 移除旧children，新的没有旧不管
        removeVnodes(elm, oldCh, 0, oldCh.length - 1);

        // 新旧children都无
      } else if (isDef(oldVnode.text)) {
        // 清空 elm text
        api.setTextContent(elm, "");
      }

      // text有值， 则children为text
    } else if (oldVnode.text !== vnode.text) {
      // 移除 旧children
      if (isDef(oldCh)) {
        removeVnodes(elm, oldCh, 0, oldCh.length - 1);
      }
      // 设置新节点 text
      api.setTextContent(elm, vnode.text!);
    }
    hook?.postpatch?.(oldVnode, vnode);
  }

  // 返回patch函数
  return function patch(
    oldVnode: VNode | Element | DocumentFragment,
    vnode: VNode
  ): VNode {
    let i: number, elm: Node, parent: Node;
    const insertedVnodeQueue: VNodeQueue = [];

    // 执行 pre hooks
    for (i = 0; i < cbs.pre.length; ++i) cbs.pre[i]();

    // 旧节点是 Element
    if (isElement(api, oldVnode)) {
      // 创建一个vnode关联到旧节点
      oldVnode = emptyNodeAt(oldVnode);
    } else if (isDocumentFragment(api, oldVnode)) {
      // documentFragment 区别： sel为undefined
      oldVnode = emptyDocumentFragmentAt(oldVnode);
    }

    // 如果新旧节点是相同节点
    if (sameVnode(oldVnode, vnode)) {
      // 对比更新节点
      patchVnode(oldVnode, vnode, insertedVnodeQueue);
    } else {
      // 如果新旧节点不是相同节点
      // 创建新的节点，并插入真实elm
      elm = oldVnode.elm!;
      parent = api.parentNode(elm) as Node;

      // 创建新的节点（递归树结构）
      createElm(vnode, insertedVnodeQueue);

      if (parent !== null) {
        // 并插入真实elm
        api.insertBefore(parent, vnode.elm!, api.nextSibling(elm));
        //  移除旧节点
        removeVnodes(parent, [oldVnode], 0, 0);
      }
    }


    // 执行 insert hooks
    for (i = 0; i < insertedVnodeQueue.length; ++i) {
      insertedVnodeQueue[i].data!.hook!.insert!(insertedVnodeQueue[i]);
    }
    for (i = 0; i < cbs.post.length; ++i) cbs.post[i]();
    return vnode;
  };
}
