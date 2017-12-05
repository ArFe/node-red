/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    "use strict";

    var _max_kept_msgs_count = undefined;

    function max_kept_msgs_count(node) {
        if (_max_kept_msgs_count === undefined) {
            var name = "sortMaxKeptMsgsCount";
            if (RED.settings.hasOwnProperty(name)) {
                _max_kept_msgs_count = RED.settings[name];
            }
            else {
                _max_kept_msgs_count = 0;
            }
        }
        return _max_kept_msgs_count;
    }

    function eval_jsonata(node, code, val) {
        try {
            return RED.util.evaluateJSONataExpression(code, val);
        }
        catch (e) {
            node.error(RED._("sort.invalid-exp"));
            throw e;
        }
    }

    function get_context_val(node, name, dval) {
        var context = node.context();
        var val = context.get(name);
        if (val === undefined) {
            context.set(name, dval);
            return dval;
        }
        return val;
    }

    function SortNode(n) {
        RED.nodes.createNode(this, n);
        var node = this;
        var pending = get_context_val(node, 'pending', {})
        var pending_count = 0;
        var order = n.order || "ascending";
        var as_num = n.as_num || false;
        var key_is_payload = (n.keyType === 'payload');
        var key_exp = undefined;
        if (!key_is_payload) {
            try {
                key_exp = RED.util.prepareJSONataExpression(n.key, this);
            }
            catch (e) {
                node.error(RED._("sort.invalid-exp"));
                return;
            }
        }
        var dir = (order === "ascending") ? 1 : -1;
        var conv = as_num
            ? function(x) { return Number(x); }
            : function(x) { return x; };

        function gen_comp(key) {
            return function(x, y) {
                var xp = conv(key(x));
                var yp = conv(key(y));
                if (xp === yp) { return 0; }
                if (xp > yp) { return dir; }
                return -dir;
            };
        }

        function send_group(group) {
            var key = key_is_payload
                ? function(msg) { return msg.payload; }
                : function(msg) {
                    return eval_jsonata(node, key_exp, msg);
                };
            var comp = gen_comp(key);
            var msgs = group.msgs;
            try {
                msgs.sort(comp);
            }
            catch (e) {
                return; // not send when error
            }
            for (var i = 0; i < msgs.length; i++) {
                var msg = msgs[i];
                msg.parts.index = i;
                node.send(msg);
            }
        }

        function sort_payload(msg) {
            var payload = msg.payload;
            if (Array.isArray(payload)) {
                var key = key_is_payload
                    ? function(elem) { return elem; }
                    : function(elem) {
                        return eval_jsonata(node, key_exp, elem);
                    };
                var comp = gen_comp(key);
                try {
                    payload.sort(comp);
                }
                catch (e) {
                    return false;
                }
                return true;
            }
            return false;
        }

        function check_parts(parts) {
            if (parts.hasOwnProperty("id") &&
                parts.hasOwnProperty("index")) {
                return true;
            }
            return false;
        }

        function process_msg(msg) {
            if (!msg.hasOwnProperty("parts")) {
                if (sort_payload(msg)) {
                    node.send(msg);
                }
                return;
            }
            var parts = msg.parts;
            if (!check_parts(parts)) {
                return;
            }
            var gid = parts.id;
            if (!pending.hasOwnProperty(gid)) {
                pending[gid] = {
                    count: undefined,
                    msgs: []
                };
            }
            var group = pending[gid];
            var msgs = group.msgs;
            msgs.push(msg);
            if (parts.hasOwnProperty("count")) {
                group.count = parts.count;
            }
            pending_count++;
            if (group.count === msgs.length) {
                delete pending[gid]
                send_group(group);
                pending_count -= msgs.length;
            }
            var max_msgs = max_kept_msgs_count(node);
            if ((max_msgs > 0) && (pending_count > max_msgs)) {
                pending = {};
                pending_count = 0;
                node.error(RED._("sort.too-many"),msg);
            }
        }

        this.on("input", function(msg) {
            process_msg(msg);
        });
    }

    RED.nodes.registerType("sort", SortNode);
}