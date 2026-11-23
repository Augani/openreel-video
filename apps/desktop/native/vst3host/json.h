// Minimal JSON value, parser and writer for the helper's protocol messages (no third-party code).
// Objects are ordered maps, so output keys are sorted exactly like the Swift helper's .sortedKeys.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace json {

struct Value;
using Array = std::vector<Value>;
using Object = std::map<std::string, Value>;

struct Value {
    enum class Kind { Null, Bool, Number, String, Array, Object } kind = Kind::Null;
    bool b = false;
    double n = 0;
    std::string s;
    std::shared_ptr<Array> a;
    std::shared_ptr<Object> o;

    Value() = default;
    Value(std::nullptr_t) {}
    Value(bool v) : kind(Kind::Bool), b(v) {}
    Value(int v) : kind(Kind::Number), n(v) {}
    Value(int64_t v) : kind(Kind::Number), n(static_cast<double>(v)) {}
    Value(uint32_t v) : kind(Kind::Number), n(v) {}
    Value(size_t v) : kind(Kind::Number), n(static_cast<double>(v)) {}
    Value(double v) : kind(Kind::Number), n(v) {}
    Value(const char* v) : kind(Kind::String), s(v) {}
    Value(std::string v) : kind(Kind::String), s(std::move(v)) {}
    Value(Array v) : kind(Kind::Array), a(std::make_shared<Array>(std::move(v))) {}
    Value(Object v) : kind(Kind::Object), o(std::make_shared<Object>(std::move(v))) {}

    bool isObject() const { return kind == Kind::Object; }
    bool isString() const { return kind == Kind::String; }
    bool isNumber() const { return kind == Kind::Number; }
    bool isArray() const { return kind == Kind::Array; }

    const Value* get(const std::string& key) const {
        if (kind != Kind::Object) return nullptr;
        auto it = o->find(key);
        return it == o->end() ? nullptr : &it->second;
    }
    std::string str(const std::string& key, const std::string& fallback = "") const {
        const Value* v = get(key);
        return v && v->isString() ? v->s : fallback;
    }
    double num(const std::string& key, double fallback) const {
        const Value* v = get(key);
        return v && v->isNumber() ? v->n : fallback;
    }
    bool boolean(const std::string& key, bool fallback) const {
        const Value* v = get(key);
        return v && v->kind == Kind::Bool ? v->b : fallback;
    }
    bool has(const std::string& key) const { return get(key) != nullptr; }
};

inline void appendUtf8(std::string& out, uint32_t cp) {
    if (cp < 0x80) out += static_cast<char>(cp);
    else if (cp < 0x800) { out += static_cast<char>(0xC0 | (cp >> 6)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { out += static_cast<char>(0xE0 | (cp >> 12)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
    else { out += static_cast<char>(0xF0 | (cp >> 18)); out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F)); out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F)); out += static_cast<char>(0x80 | (cp & 0x3F)); }
}

class Parser {
public:
    explicit Parser(const std::string& text) : t(text) {}
    Value parse() {
        Value v = value(0);
        ws();
        if (i != t.size()) fail("trailing characters");
        return v;
    }
private:
    const std::string& t;
    size_t i = 0;
    [[noreturn]] void fail(const char* m) { throw std::runtime_error(std::string("json: ") + m); }
    void ws() { while (i < t.size() && (t[i] == ' ' || t[i] == '\n' || t[i] == '\t' || t[i] == '\r')) i++; }
    bool lit(const char* w) { size_t n = std::char_traits<char>::length(w); if (t.compare(i, n, w) == 0) { i += n; return true; } return false; }
    uint32_t hex4() {
        if (i + 4 > t.size()) fail("bad \\u escape");
        uint32_t v = 0;
        for (int k = 0; k < 4; k++) {
            char c = t[i++]; v <<= 4;
            if (c >= '0' && c <= '9') v |= c - '0'; else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10; else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10; else fail("bad \\u escape");
        }
        return v;
    }
    std::string string() {
        if (t[i] != '"') fail("expected string");
        i++;
        std::string out;
        while (i < t.size() && t[i] != '"') {
            char c = t[i++];
            if (c != '\\') { out += c; continue; }
            if (i >= t.size()) fail("bad escape");
            char e = t[i++];
            switch (e) {
                case '"': out += '"'; break; case '\\': out += '\\'; break; case '/': out += '/'; break;
                case 'b': out += '\b'; break; case 'f': out += '\f'; break; case 'n': out += '\n'; break; case 'r': out += '\r'; break; case 't': out += '\t'; break;
                case 'u': {
                    uint32_t cp = hex4();
                    if (cp >= 0xD800 && cp < 0xDC00 && t.compare(i, 2, "\\u") == 0) { i += 2; uint32_t lo = hex4(); cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00); }
                    appendUtf8(out, cp);
                    break;
                }
                default: fail("bad escape");
            }
        }
        if (i >= t.size()) fail("unterminated string");
        i++;
        return out;
    }
    Value value(int depth) {
        if (depth > 64) fail("too deep");
        ws();
        if (i >= t.size()) fail("unexpected end");
        char c = t[i];
        if (c == '{') {
            i++; Object obj; ws();
            if (t[i] == '}') { i++; return Value(std::move(obj)); }
            for (;;) {
                ws(); std::string k = string(); ws();
                if (i >= t.size() || t[i] != ':') fail("expected ':'");
                i++;
                obj[k] = value(depth + 1); ws();
                if (i < t.size() && t[i] == ',') { i++; continue; }
                if (i < t.size() && t[i] == '}') { i++; break; }
                fail("expected ',' or '}'");
            }
            return Value(std::move(obj));
        }
        if (c == '[') {
            i++; Array arr; ws();
            if (t[i] == ']') { i++; return Value(std::move(arr)); }
            for (;;) {
                arr.push_back(value(depth + 1)); ws();
                if (i < t.size() && t[i] == ',') { i++; continue; }
                if (i < t.size() && t[i] == ']') { i++; break; }
                fail("expected ',' or ']'");
            }
            return Value(std::move(arr));
        }
        if (c == '"') return Value(string());
        if (lit("true")) return Value(true);
        if (lit("false")) return Value(false);
        if (lit("null")) return Value(nullptr);
        size_t start = i;
        while (i < t.size() && (t[i] == '-' || t[i] == '+' || t[i] == '.' || t[i] == 'e' || t[i] == 'E' || (t[i] >= '0' && t[i] <= '9'))) i++;
        if (start == i) fail("unexpected character");
        return Value(std::strtod(t.substr(start, i - start).c_str(), nullptr));
    }
};

inline Value parse(const std::string& text) { return Parser(text).parse(); }

inline void writeString(std::string& out, const std::string& s) {
    out += '"';
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break; case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break; case '\r': out += "\\r"; break; case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof buf, "\\u%04x", c); out += buf; } else out += static_cast<char>(c);
        }
    }
    out += '"';
}

inline void write(std::string& out, const Value& v) {
    switch (v.kind) {
        case Value::Kind::Null: out += "null"; break;
        case Value::Kind::Bool: out += v.b ? "true" : "false"; break;
        case Value::Kind::Number: {
            if (!std::isfinite(v.n)) { out += "null"; break; }
            char buf[40];
            if (v.n == std::floor(v.n) && std::fabs(v.n) < 9e15) std::snprintf(buf, sizeof buf, "%lld", static_cast<long long>(v.n));
            else std::snprintf(buf, sizeof buf, "%.17g", v.n);
            out += buf; break;
        }
        case Value::Kind::String: writeString(out, v.s); break;
        case Value::Kind::Array: {
            out += '[';
            bool first = true;
            for (const Value& e : *v.a) { if (!first) out += ','; first = false; write(out, e); }
            out += ']'; break;
        }
        case Value::Kind::Object: {
            out += '{';
            bool first = true;
            for (const auto& kv : *v.o) { if (!first) out += ','; first = false; writeString(out, kv.first); out += ':'; write(out, kv.second); }
            out += '}'; break;
        }
    }
}

inline std::string dump(const Value& v) { std::string out; write(out, v); return out; }

} // namespace json
