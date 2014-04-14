/*jslint indent: 2, vars: true, forin: true */
/*global define: false, tern: false, CoffeeScript: false */
(function (mod) {
  "use strict";
  if (typeof exports === "object" && typeof module === "object") {// CommonJS
    return mod(require("../lib/tern"),
      require('coffee-script'),
      require('../node_modules/coffee-script/lib/coffee-script/lexer'),
      require('../node_modules/coffee-script/lib/coffee-script/parser'));
  }
  if (typeof define === "function" && define.amd) {// AMD
    return define(["../lib/tern", "coffee-script/extras/coffee-script", "coffee-script/lib/lexer", "coffee-script/lib/parser"], mod);
  }
  mod(tern, CoffeeScript, CoffeeScript.require('./lexer'), CoffeeScript.require('./parser'));
}(function (tern, CoffeeScript, Lexer, parser) {
  "use strict";

  Lexer = Lexer.Lexer;
  parser = parser.parser;
  // https://github.com/mntmn/tern-coffeescript/blob/master/cs/coffee-reverse.js
  // by @mntmn
  // Modified to meet jslint
  CoffeeScript.compileWithReverseMap = function (code, options) {
    var currentColumn, currentLine, err, fragment, fragments, js, newLines, _j, _len1;

    var reverseMap = {};

    if (!options) { options = {}; }

    var lexer = new Lexer();

    var helpers = this.helpers;

    try {
      fragments = (parser.parse(lexer.tokenize(code, options))).compileToFragments(options);
      currentLine = 0;
      currentColumn = 0;

      js = "";
      var accumulatedX = 0;

      var sy, sx;
      for (_j = 0, _len1 = fragments.length; _j < _len1; _j++) {
        fragment = fragments[_j];

        if (!(options.skips && options.skips.indexOf(fragment.code) >= 0)) {
          if (fragment.type !== "Block" && fragment.locationData) {
            sy = fragment.locationData.first_line;
            sx = fragment.locationData.first_column;

            if (!reverseMap[sy]) {
              reverseMap[sy] = {};
            }

            reverseMap[sy][sx] = {
              y: currentLine,
              x: accumulatedX,
              l: fragment.code.length
            };
          }

          newLines = helpers.count(fragment.code, "\n");
          currentLine += newLines;
          currentColumn = fragment.code.length - (newLines ? fragment.code.lastIndexOf("\n") : 0);

          if (newLines) { accumulatedX = 0; }
          accumulatedX += currentColumn;

          js += fragment.code;
        }
      }

      return {
        js: js,
        reverseMap: reverseMap
      };
    } catch (_error) {
      err = _error;
      if (options.filename) {
        err.message = "In " + options.filename + ", " + err.message;
      }
      throw err;
    }
  };

  tern.registerPlugin("coffee", function (server) {
    var getFile = server.options.getFile;

    server.options.getFile = function (name, c) {
      var candidates = [name];

      if (/\.js$/.test(name)) {
        candidates.unshift(name.replace(/\.js$/, '.coffee'));
        candidates.unshift(name + '.coffee');
      } else if (!/\.coffee$/.test(name)) {
        candidates.unshift(name + '.coffee');
      }

      var candidate = candidates.shift();

      var callback = function (error, data) {
        if (error) {
          candidate = candidates.shift();
          if (candidate) {
            getFile(candidate, callback);
          } else {
            c(error);
          }
        } else {
          if (/\.coffee$/.test(candidate)) {
            data = CoffeeScript.compile(data, {bare: true});
          }
          c(null, data);
        }
      };

      getFile(candidate, callback);

    };

    var preRequest = function (doc) {
      var i, j;
      var compiled = {};
      var cache_compiled = {};

      var ref = null;
      var refName = null;
      var hasEnd = false;

      var requireMap = false;

      if (doc.query && doc.query.file) {
        var name = doc.query.file;
        var isRef = name.match(/^#(\d+)$/);
        hasEnd = (!!doc.query.end);
        if (isRef) {
          ref = isRef[1];
        } else {
          if (/\.coffee$/.test(doc.query.file)) {
            requireMap = true;
          }
          refName = doc.query.file;
        }
      }

      if (doc.files) {
        var lines;
        var line;
        var ch;
        var indent;
        var currentIndent;
        var file;
        var lastj = 0;

        for (i in doc.files) {
          file = doc.files[i];
          if (/\.coffee$/.test(file.name)) {
            if (hasEnd && (i === ref || file.name === refName)) {
              requireMap = true;
              lines = file.text.split('\n');
              line = lines[doc.query.end.line];
              ch = line[doc.query.end.ch - 1];
              if (ch === '.' && (line.length === doc.query.end.ch || line[doc.query.end.ch] === ' ')) {
                line = line.slice(0, doc.query.end.ch) + '__fake__' + line.slice(doc.query.end.ch);
                lines[doc.query.end.line] = line;
              }

              line = lines[doc.query.end.line];
              indent = line.match(/^\s*/)[0].length;
              for (j = doc.query.end.line + 1; j < lines.length; j++) {
                line = lines[j];
                if (indent > line.match(/^\s*/)[0].length) {
                  break;
                }
              }
              lines.splice(j);

              line = lines[doc.query.end.line];
              indent = line.match(/^\s*/)[0].length;
              for (j = doc.query.end.line - 1; j >= 0; j--) {
                line = lines[j];
                currentIndent = line.match(/^\s*/)[0].length;
                if (indent >= currentIndent) {
                  indent = currentIndent;
                  lastj = j;
                }
              }
              lines.splice(0, lastj);
              file.text = lines.join('\n');
            }
            try {
              compiled = CoffeeScript.compileWithReverseMap(file.text, {skips: ['__fake__']});
            } catch (error) {
              return false;
            }
            file.text = compiled.js;
            if (i === ref || file.name === refName) {
              cache_compiled = compiled;
            }
          }
        }
      }

      if (requireMap) {
        compiled = cache_compiled;
        var cursor = doc.query.end;

        // https://github.com/mntmn/tern-coffeescript/blob/master/cs/demo-cs.js
        line = compiled.reverseMap[cursor.line - lastj];

        var targetLines = compiled.js.split("\n");
        var targetY = 0, targetX = 0, targetFragLen = 0;

        var sourceCols = Object.keys(line);
        // var sourceCol, nextCol, tl;
        var sourceCol, nextCol;

        for (i = 0; i < sourceCols.length; i++) {
          sourceCol = sourceCols[i];
          nextCol = 10000;
          if (i < sourceCols.length - 1) {
            nextCol = sourceCols[i + 1];
          }

          if (cursor.ch >= sourceCol && cursor.ch <= nextCol) {
            //console.log("cursor between: ",sourceCol,nextCol);
            // tl = targetLines[line[sourceCol].y];
            targetY = line[sourceCol].y;
            targetX = line[sourceCol].x - 1;
            targetFragLen = line[sourceCol].l;
            //console.log("target line: ",line,tl);
          }
        }

        // calculate offset
        var offset = 0;
        var llen;
        for (i = 0; i < targetY; i++) {
          llen = targetLines[i].length + 1;
          offset += llen;
        }

        offset += targetX;
        //console.log("tx,ty,offset: ",targetX,targetY,offset);
        doc.query.start = offset;
        doc.query.end = offset + targetFragLen;
        //console.log(doc.query.end);
      }
      return line;
    };
    var postRequest = function (data, line) {
      if (line && data.end) {
        var len = data.end.ch - data.start.ch;
        var pos;
        for (pos in line) {
          pos = parseInt(pos, 10);
          if (line[pos].x === data.start.ch) {
            break;
          }
        }
        data.start.ch = pos + 1;
        data.end.ch = pos + len + 1;
      }
    };

    // Baseline query document validation
    // https://github.com/marijnh/tern/blob/master/lib/tern.js#L402
    function isPosition(val) {
      return typeof val === "number" || (typeof val === "object" &&
        typeof val.line === "number" && typeof val.ch === "number");
    }

    function invalidDoc(doc) {
      var i, file, returner;
      if (doc.query) {
        if (typeof doc.query.type !== "string") { return ".query.type must be a string"; }
        if (doc.query.start && !isPosition(doc.query.start)) { return ".query.start must be a position"; }
        if (doc.query.end && !isPosition(doc.query.end)) { return ".query.end must be a position"; }
      }
      if (doc.files) {
        if (!Array.isArray(doc.files)) { return "Files property must be an array"; }
        for (i = 0; i < doc.files.length; ++i) {
          file = doc.files[i];
          if (typeof file !== "object") {
            returner = ".files[n] must be objects";
          } else if (typeof file.text !== "string") {
            returner = ".files[n].text must be a string";
          } else if (typeof file.name !== "string") {
            returner = ".files[n].name must be a string";
          } else if (file.type === "part") {
            if (!isPosition(file.offset) && typeof file.offsetLines !== "number") {
              returner = ".files[n].offset must be a position";
            }
          } else if (file.type !== "full") { returner = ".files[n].type must be \"full\" or \"part\""; }

          if (returner) {
            return returner;
          }
        }
      }
    }

    var request = server.request;
    var preData;
    server.request = function (doc, c) {
      var srv = this;
      var inv = invalidDoc(doc);
      if (inv) { return c(inv); }
      preData = preRequest(doc);
      if (preData === false) {
        return c('Compile CoffeeScript Failed');
      }
      var callback = function (error, data) {
        if (error) {
          c(error);
        } else {
          postRequest(data, preData);
          c(null, data);
        }
      };
      request.call(srv, doc, callback);
    };


  });

  return;
}));
