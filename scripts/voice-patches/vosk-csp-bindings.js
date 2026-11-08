// th.ink modification: CSP-compatible bindings for vosk-browser 0.0.8.
// Replace runtime JavaScript compilation with ordinary closures. The WASM,
// argument conversion, return conversion, and destructor ordering are unchanged.
function createNamedFunction(name, body) {
  var wrapper = function() {
    'use strict';
    return body.apply(this, arguments);
  };
  Object.defineProperty(wrapper, 'name', {value: makeLegalFunctionName(name)});
  return wrapper;
}

function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
  var argCount = argTypes.length;
  if (argCount < 2) throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
  var isClassMethodFunc = argTypes[1] !== null && classType !== null;
  var needsDestructorStack = argTypes.slice(1).some(function(type) {
    return type !== null && type.destructorFunction === undefined;
  });
  var returns = argTypes[0].name !== 'void';
  return createNamedFunction(humanName, function() {
    if (arguments.length !== argCount - 2) {
      throwBindingError('function ' + humanName + ' called with ' + arguments.length + ' arguments, expected ' + (argCount - 2) + ' args!');
    }
    var destructors = needsDestructorStack ? [] : null;
    var wired = [cppTargetFunc];
    if (isClassMethodFunc) wired.push(argTypes[1].toWireType(destructors, this));
    for (var i = 0; i < argCount - 2; i++) wired.push(argTypes[i + 2].toWireType(destructors, arguments[i]));
    var result = cppInvokerFunc.apply(null, wired);
    if (needsDestructorStack) runDestructors(destructors);
    else {
      var first = isClassMethodFunc ? 1 : 2;
      for (var i = first; i < argCount; i++) {
        if (argTypes[i].destructorFunction !== null) argTypes[i].destructorFunction(wired[i - first + 1]);
      }
    }
    if (returns) return argTypes[0].fromWireType(result);
  });
}

function __emval_get_method_caller(argCount, argTypes) {
  var types = __emval_lookupTypes(argCount, argTypes);
  var retType = types[0];
  return __emval_addMethodCaller(function(handle, name, destructors, args) {
    var values = [], offset = 0;
    for (var i = 1; i < argCount; i++) {
      values.push(types[i].readValueFromPointer(args + offset));
      offset += types[i].argPackAdvance;
    }
    var result = handle[name].apply(handle, values);
    for (var i = 1; i < argCount; i++) {
      if (types[i].deleteObject) types[i].deleteObject(values[i - 1]);
    }
    if (!retType.isVoid) return retType.toWireType(destructors, result);
  });
}
