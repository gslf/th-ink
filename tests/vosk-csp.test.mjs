import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const bindings=readFileSync(new URL('../scripts/voice-patches/vosk-csp-bindings.js',import.meta.url),'utf8');
function runtime(extra={}){
 const context=vm.createContext({makeLegalFunctionName:name=>name.replace(/\W/g,'_'),throwBindingError:message=>{throw Error(message);},runDestructors:stack=>{while(stack.length){const value=stack.pop();stack.pop()(value);}},...extra},{codeGeneration:{strings:false,wasm:false}});
 vm.runInContext(bindings,context);return context;
}
test('CSP bindings create callable and constructable named functions without string evaluation',()=>{
 const c=runtime();assert.throws(()=>vm.runInContext('new Function("return 1")',c),/Code generation/);
 const Constructor=c.createNamedFunction('Example type',function(value){this.value=value;});
 assert.equal(Constructor.name,'Example_type');const value=new Constructor(42);assert.equal(value.value,42);assert.ok(value instanceof Constructor);
 assert.equal(c.createNamedFunction('sum',function(n){return this.base+n;}).call({base:7},5),12);
});
test('CSP invokers preserve instance conversion, return conversion and direct destructor order',()=>{
 const log=[],c=runtime(),type=name=>({name,toWireType:(_,value)=>value.id,destructorFunction:value=>log.push([name,value])});
 const types=[{name:'number',fromWireType:value=>value*2},type('this'),type('first'),type('second')];
 const invoke=c.craftInvokerFunction('example',types,{},(target,self,a,b)=>{assert.equal(target,99);return self+a+b;},99);
 assert.equal(invoke.call({id:1},{id:2},{id:3}),12);assert.deepEqual(log,[['this',1],['first',2],['second',3]]);
 assert.throws(()=>invoke.call({id:1},{id:2}),/expected 2 args/);
});
test('CSP free invokers unwind destructor stacks and support void zero-argument functions',()=>{
 const c=runtime(),log=[];
 const arg={name:'argument',toWireType:(stack,value)=>{stack.push(x=>log.push(x),value);return value+1;}};
 const invoke=c.craftInvokerFunction('example',[{name:'number',fromWireType:x=>x},null,arg,arg],null,(_,a,b)=>a+b,0);
 assert.equal(invoke(2,5),9);assert.deepEqual(log,[5,2]);
 let called=false;const empty=c.craftInvokerFunction('empty',[{name:'void'},null],null,()=>{called=true;return 42;},0);
 assert.equal(empty(),undefined);assert.equal(called,true);
});
test('CSP method callers preserve offsets, receiver, argument disposal and wire return values',()=>{
 const log=[],types=[{isVoid:false,toWireType:(stack,value)=>{assert.equal(stack,'stack');return value*2;}},...['a','b'].map(name=>({argPackAdvance:8,readValueFromPointer:ptr=>{log.push(['read',ptr]);return ptr;},deleteObject:value=>log.push([name,value])}))];
 const c=runtime({__emval_lookupTypes:()=>types,__emval_addMethodCaller:fn=>fn});
 const receiver={base:3,sum(a,b){return this.base+a+b;}};
 assert.equal(c.__emval_get_method_caller(3,0)(receiver,'sum','stack',16),86);
 assert.deepEqual(log,[['read',16],['read',24],['a',16],['b',24]]);
});
