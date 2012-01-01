/*
* Copyright (c) 2011 FeZo, Inc. A Delaware Corporation.
* 
* Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
* 
* The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
* 
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/**
 Creates a JSON Patch class.
 @class A class allowing the application of JSON Patch Documents corresponding to:
 draft-pbryan-json-patch-04 http://tools.ietf.org/html/draft-pbryan-json-patch-04
 with the addition of 'value' in 'remove' operation and 'replacedValue' in 'replace'
 operation. These additions allow for both forward and reverse JSON patching.
 @author <a href="mailto:greg@fezo.com">Greg Ray</a>
*/
function JSONPatch() {}

JSONPatch.prototype = {
    
    /**
        Operations currently supported within a JSONPatch document.
    */
    validOperations: ['test', 'remove', 'add', 'replace', 'move'],
    
    /**
        Validates and runs patchDoc on originalDoc. If originalDoc is of Object type, originalDoc will by modified by ref.
        @example
        [
        	{ "test": "/a/b/c", value: "foo" },
        	{ "remove": "/a/b/c", value: "foo" },
        	{ "add": "/a/b/c", "value": [ "foo", "bar" ] },
        	{ "replace": "/a/b/c", "value": 42, replacedValue: 24 },
        	{ "move": "/a/b/c", to: "/a/b/d" },
        ];
        @param {Object|String} originalDoc A JSON document (parsed or text) that will be patched.
        @param {Array|String} patchDoc A JSON document array (parsed or text) that will be used to patch originalDoc.
        @param {Boolean} [reverse=false] Indicates wether the patch should be reversed, typically for undoing a patch.
    */
    runPatch: function(originalDocument, patchDocument, reverse) {
        if(typeof(originalDocument) === 'string') {
            try{
                originalDocument = JSON.parse(originalDocument);
            } catch(err) {
                throw "Invalid originalDocument string."
            }   
        }
        if(typeof(reverse) === 'undefined') {
            reverse = false;
        }
        try {
            if(typeof(patchDocument) === 'string') {
                patchDocument = JSON.parse(patchDocument);
            } 
        } catch (err) {
            throw "Invalid JSON patch, err: " + err;
        }
        if(reverse) {
            patchDocument = this.reversePatch(patchDocument); //reversePatch performs validatePatchDoc, purposerly breking DRY rules for optimization (prevent double validation)
            for(var i = 0, iLen = patchDocument.length; i < iLen; i++) {
                this.applyPatchOperation(originalDocument, patchDocument[i]);
            }
        } else {
            if(this.validatePatchDoc(patchDocument)) {
                for(var i = 0, iLen = patchDocument.length; i < iLen; i++) {
                    this.applyPatchOperation(originalDocument, patchDocument[i]);
                }
            } else {
                throw "Invalid JSON patch."
            }
        }
        
        return originalDocument;
    },
    
    /**
        Generates a JSON patch document by finding differences between originalDocument and diffDocument.
        @param {Object|String} originalDocument A JSON document (parsed or text).
        @param {Object|String} diffDocument A JSON document (parsed or text).
        @returns {Array} A valid JSON patch document.
    */
    generatePatch: function(originalDocument, diffDocument) {
        
        //ensure real objects and not strings
        if(typeof(originalDocument) === 'string') {
            try{
                originalDocument = JSON.parse(originalDocument);
            } catch(err) {
                throw "Invalid originalDocument string."
            }   
        }
        
        if(typeof(diffDocument) === 'string') {
            try{
                diffDocument = JSON.parse(diffDocument);
            } catch(err) {
                throw "Invalid diffDocument string."
            }   
        }
        
        //removedTokens array to track what has presently been removed during patch generation
        var removedTokens = [];
        
        /**
            Generates array of nodes from json obj. Example response.
            @param {Object} obj A JSON document (parsed) to traverse.
            @param {Number} dist Distance from obj root.
            @param {String} jsonPointer JSON Pointer to obj from root.
            @param {Array} array Passed by ref, contains nodes traversed by function.
            @returns {Array} Array of nodes with format: {node: Object, dist: Number, jsonPointer: String, isLeaf: Boolean}
            @inner
        */
        function traverseDoc(obj, dist, jsonPointer, array){
            for(var i in obj) {
                var node = obj[i];
                array.push({node: node, dist: dist, jsonPointer: jsonPointer + i.toString() + "/", isLeaf: (typeof(node) !== 'object')});
                if(typeof(node) === 'object') {
                    traverseDoc(node, dist+1, jsonPointer + i.toString() + "/", array);
                }
            }
        }
        
        /**
            Checks if JSON values a and b are structurally equivalent.
            @param {var} a A value, leaf or branch, for comparison.
            @param {var} b A value, leaf or branch, for comparison.
            @returns {Boolean} Returns true if a and b are structurally equivalent.
            @inner
        */
        function doesMatch(a, b) {
            if(typeof(a) !== 'object' && typeof(b) !== 'object') {
                return (a === b);
            } else if (typeof(a) === 'object' && typeof(b) !== 'object') {
                return false;
            } else if (typeof(a) !== 'object' && typeof(b) === 'object') {
                return false;
            }
                
            var aNodes = [];
            traverseDoc(a, 0, "/", aNodes);
            for(var i = 0, iLen = aNodes.length; i < iLen; i++) {
                var node = aNodes[i];
                try {
                    resolveJSONPointer(b, node.jsonPointer);
                } catch (err) {
                    return false;
                }
            }
            var bNodes = [];
            traverseDoc(b, 0, "/", bNodes);
            for(var i = 0, iLen = bNodes.length; i < iLen; i++) {
                var node = bNodes[i];
                try {
                    resolveJSONPointer(a, node.jsonPointer);
                } catch (err) {
                    return false;
                }
            }
            return true;
        }
        
        /**
            Traverses doc and returns array of jsonPointers to locations where value is structurally equivalent to passed value.
            @param {doc} doc A JSON document (parsed) to traverse.
            @param {var} value A value, leaf or branch, for comparison.
            @returns {Array} An array of JSON Pointers.
            @inner
        */
        function jsonPointersWithMatchingValue(doc, value) {
            var jsonPointers = [];
            var nodes = [];
            traverseDoc(doc, 0, "/", nodes);
            for(var i = 0, iLen = nodes.length; i < iLen; i++) {
                var node = nodes[i];
                var resolvedValue = resolveJSONPointer(doc, node.jsonPointer);
                if(node.isLeaf) {
                    if (value === resolvedValue) {
                        jsonPointers.push(node.jsonPointer);
                    }
                } else {
                    if (doesMatch(value, resolvedValue)) {
                        jsonPointers.push(node.jsonPointer);
                    }
                }
            }
            return jsonPointers;
        }
        
        //patches array to hold each patch
        var moveAddPatches = [];
        
        //initialize and populate diffDocNodes array
        var diffDocNodes = [];
        traverseDoc(diffDocument, 0, "/", diffDocNodes);
        
        //sort array based on dist from root, descending
        diffDocNodes.sort(function(a,b){
           return b.dist - a.dist;
        });
        
        //find any additions in diffDoc not in originalDoc
        for(var i = 0, iLen = diffDocNodes.length; i < iLen; i++) {
            var node = diffDocNodes[i];
            try{
                resolveJSONPointer(originalDocument, node.jsonPointer);
            } catch(err) {
                //does not resolve in original document, ensure it was not a move
                var wasMove = false;
                var diffValue = resolveJSONPointer(diffDocument, node.jsonPointer);
                var matchingLocations = jsonPointersWithMatchingValue(originalDocument, diffValue);
                var jsonPointerLocationInOriginalDoc;
                for (var x = 0, xLen = matchingLocations.length; x < xLen; x++) {
                    jsonPointerLocationInOriginalDoc = matchingLocations[x];
                    try{
                        resolveJSONPointer(diffDocument, jsonPointerLocationInOriginalDoc);
                    } catch(err){
                        //if it does exist in diffDocument then its just duplicated value, if not, its a move
                        wasMove = true;
                        break;
                    }
                }
                if(wasMove) {
                    moveAddPatches.push({ "move": jsonPointerLocationInOriginalDoc, to: node.jsonPointer });
                } else {
                    moveAddPatches.push({ "add": node.jsonPointer, "value": diffValue });
                }
            }
        }
        
        originalDocument = this.runPatch(JSON.stringify(originalDocument), moveAddPatches);
        
        //patches array to hold each patch
        var patches = [];
        
        //initialize and populate originalDocNodes array
        var originalDocNodes = [];
        traverseDoc(originalDocument, 0, "/", originalDocNodes);
        
        //sort array based on dist from root, descending
        originalDocNodes.sort(function(a,b){
           return b.dist - a.dist;
        });
        
        var movedPointers = [];
        for(var i = 0, iLen = originalDocNodes.length; i < iLen; i++) {
            var moddedOriginal = this.runPatch(JSON.stringify(originalDocument), patches);
            var node = originalDocNodes[i];
            var originalVal;
            var diffVal;
            try{
                originalVal = resolveJSONPointer(moddedOriginal, node.jsonPointer);
                diffVal = resolveJSONPointer(diffDocument, node.jsonPointer);
                if (doesMatch(originalVal, diffVal)) {
                    continue; //no diff, move on to next node
                } else {
                    var pointer = node.jsonPointer;
                    if(pointer[0] === '/') {
                        pointer = pointer.slice(1,pointer.length);
                    }
                    if(pointer[pointer.length-1] === '/') {
                        pointer = pointer.slice(0,pointer.length-1);
                    }
                    var tokens = pointer.split('/');
                    var parent = resolveJSONPointer(moddedOriginal, tokens.slice(0,tokens.length-1).join('/'));
                    var diffParent = resolveJSONPointer(diffDocument, tokens.slice(0,tokens.length-1).join('/'));
                    if(Object.prototype.toString.call(parent) === '[object Array]' && Object.prototype.toString.call(diffParent) === '[object Array]') {
                        //todo: detect deletion of a item in array and use 'remove' operation instead
                        patches.push({ "replace": tokens.slice(0,tokens.length-1).join('/'), value: diffParent, replacedValue: parent}); 
                        for(var idx in parent){
                            removedTokens.push(tokens.slice(0,tokens.length-1).join('/') + '/' + idx);
                        }
                        continue;
                    } else {
                        patches.push({ "replace": node.jsonPointer, value: diffVal, replacedValue: originalVal});
                        continue;
                    }                    
                }
            } catch (err) {
                //key doesn't exist at jsonPointer loc in diffDocument, moving on to check if it was moved
            }
            
            //was not moved or replaced, it was removed, move down jsonPointer to find source of removal
            var pointer = node.jsonPointer;
            if(pointer[0] === '/') {
                pointer = pointer.slice(1,pointer.length);
            }
            if(pointer[pointer.length-1] === '/') {
                pointer = pointer.slice(0,pointer.length-1);
            }
            var tokens = pointer.split('/');
            for(var x = 0, xLen = tokens.length; x < xLen; x++) {
                var token = tokens[x];
                var currentPointer = tokens.slice(0,x+1).join('/');
                try{
                    resolveJSONPointer(diffDocument, currentPointer);
                } catch(err) {
                    var alreadyRemoved = false;
                    for(var y = 0, yLen = removedTokens.length; y < yLen; y++) {
                        var removedToken = removedTokens[y];
                        if (removedToken == currentPointer) {
                            alreadyRemoved = true;
                            break;
                        }
                    }
                    if(!alreadyRemoved) {
                        var val = resolveJSONPointer(originalDocument, currentPointer);
                        patches.push({ "remove": currentPointer, "value":  val});
                        removedTokens.push(currentPointer);
                    }
                }
            }
        }

        return moveAddPatches.concat(patches);
    },
    
    /**
        Reverses patch document, typically used for undoing patch.
        @param {Object|String} patchDoc A JSON Patch Document (parsed or text).
        @returns {Array} A valid JSON patch document, with both order and operations reversed.
    */
    reversePatch: function(patchDoc) {
        try {
            if(typeof(patchDoc) === 'string') {
                patchDoc = JSON.parse(patchDoc);
            } 
        } catch (err) {
            throw "Invalid JSON patch, err: " + err;
        }
        if (!this.validatePatchDoc(patchDoc)) {
          throw "Invalid JSON patch."
        }
        
        //clone and reverse
        var reversePatchCopy = JSON.parse(JSON.stringify(patchDoc)).reverse();
        for (var i = 0, iLen = reversePatchCopy.length; i < iLen; i++) {
            var operation = reversePatchCopy[i];
            for(var x = 0, xLen = this.validOperations.length; x < xLen; x++) {
                var validOperationName = this.validOperations[x];
                if(typeof(operation[validOperationName]) !== 'undefined') {
                    var pointer = operation[validOperationName];
                    switch(validOperationName){
                        case 'remove':
                            delete operation['remove'];
                            operation['add'] = pointer;
                            break;
                        case 'add':
                            delete operation['add'];
                            operation['remove'] = pointer;
                            break;
                        case 'replace':
                            var replacedValueCopy = JSON.parse(JSON.stringify(operation['replacedValue']));
                            var valueCopy = JSON.parse(JSON.stringify(operation['value']));
                            operation['value'] = replacedValueCopy;
                            operation['replacedValue'] = valueCopy;
                            break;
                        case 'move':
                            var moveCopy = JSON.parse(JSON.stringify(operation['move']));
                            var toCopy = JSON.parse(JSON.stringify(operation['to']));
                            operation['move'] = toCopy;
                            operation['to'] = moveCopy;
                            break;
                    }
                    break; //matching valid operation, break
                }
            }
        }
        
        return reversePatchCopy;
    },
    
    /**
        Validates patch document ensuring that one of the validOperations is present within each
        operation and that necessary meta members are present per operation type.
        @param {Object|String} patchDoc A JSON Patch Document (parsed or text).
        @returns {Boolean} True if patch is valid.
    */
    validatePatchDoc: function(patchDoc) {
        if (Object.prototype.toString.call(patchDoc) !== '[object Array]') {
            return false;
        }
        for(var i = 0, iLen = patchDoc.length; i < iLen; i++) {
            var containsValidOperation = false;
            var patchOperation = patchDoc[i];
            if ((typeof(patchOperation) !== 'object' || Object.prototype.toString.call(patchOperation) === '[object Array]')) {
                return false;
            }
            for(var key in patchOperation) {
                validOperationsLoop:
                for(var x = 0, xLen = this.validOperations.length; x < xLen; x++) {
                    var validOperation = this.validOperations[x];
                    if (key == validOperation) {
                        switch(validOperation){
                            case 'test':
                                if(typeof(patchOperation['value']) !== 'undefined') {
                                    containsValidOperation = true;
                                    break validOperationsLoop;
                                }
                                break;
                            case 'remove':
                                if(typeof(patchOperation['value']) !== 'undefined') {
                                    containsValidOperation = true;
                                    break validOperationsLoop;
                                }
                                break;
                            case 'add':
                                if(typeof(patchOperation['value']) !== 'undefined') {
                                    containsValidOperation = true;
                                    break validOperationsLoop;
                                }
                                break;
                            case 'replace':
                                if(typeof(patchOperation['value']) !== 'undefined' && typeof(patchOperation['replacedValue']) !== 'undefined') {
                                    containsValidOperation = true;
                                    break validOperationsLoop;
                                }
                                break;
                            case 'move':
                                if(typeof(patchOperation['to']) !== 'undefined') {
                                    containsValidOperation = true;
                                    break validOperationsLoop;
                                }
                                break;
                        }
                        break;
                    }
                }
            }
            if(containsValidOperation === false) {
                console.log('Invalid condition in patch doc at index ' + i);
                return false;
            }
        }
        return true;
    },
    
    /**
        Applies one of the following validOperations, modifying originalDocument.
        @param {Object|String} originalDocument A JSON document (parsed or text).
        @param {Object|String} operation A valid patch operation to run on originalDocument.
        @returns {Object} A patched originalDocument.
    */
    applyPatchOperation: function(originalDoc, operation){
        if(typeof(originalDoc) === 'string') {
            try{
                originalDoc = JSON.parse(originalDoc);
            } catch(err) {
                throw "Invalid originalDocument string."
            }   
        }
        if(typeof(operation) === 'string') {
            try{
                operation = JSON.parse(operation);
            } catch(err) {
                throw "Invalid operation string."
            }   
        }
        for(var x = 0, xLen = this.validOperations.length; x < xLen; x++) {
            var validOperationName = this.validOperations[x];
            if(typeof(operation[validOperationName]) !== 'undefined') {
                var pointer = operation[validOperationName];
                if(pointer[0] === "/") {
                    pointer = pointer.slice(1);
                }
                if(pointer[pointer.length-1] === "/") {
                    pointer = pointer.slice(0,pointer.length-1);
                }
                switch(validOperationName){
                    case 'test':
                        try {
                            var resolvedObject = resolveJSONPointer(originalDoc, pointer);
                            if (resolvedObject !== operation['value']) {
                                throw "Resolved object at " + pointer + " is not equal to " +  operation['value'] + "."; 
                            }
                        } catch (err) {
                            throw "Test Failed, err: " + err;
                        }
                        break;
                    case 'remove':
                        try {
                            if(pointer === "") {
                                throw "Can not apply 'remove' operation targeting root."
                            }
                            var numberTokens = pointer.split('/').length;
                            var parentPointer = pointer.split('/').slice(0,numberTokens-1).join('/');
                            var resolvedObjectParent = resolveJSONPointer(originalDoc, parentPointer);
                            if(typeof(resolvedObjectParent[pointer.split('/').slice(-1)[0]]) === 'undefined') {
                                throw "Unable to resolve pointer: " + pointer;
                            }
                            if (Object.prototype.toString.call(resolvedObjectParent) === '[object Array]') {
                                if(isNaN(pointer.split('/').slice(-1)[0])) {
                                    throw "Resolved target's parent is an array but target is NaN for pointer: " + pointer;
                                }
                                resolvedObjectParent.splice(pointer.split('/').slice(-1)[0], 1);
                            } else {
                                delete resolvedObjectParent[pointer.split('/').slice(-1)[0]];
                            }
                        } catch (err) {
                            throw "Remove Failed, err: " + err;
                        }
                        break;
                    case 'add':
                        try {
                            if(pointer === "") {
                                throw "Can not apply 'add' operation targeting root."
                            }
                            var numberTokens = pointer.split('/').length;
                            var parentPointer = pointer.split('/').slice(0,numberTokens-1).join('/');
                            var resolvedObjectParent = resolveJSONPointer(originalDoc, parentPointer);
                            var objectExists = true;
                            try {
                                resolveJSONPointer(originalDoc, pointer);
                            } catch(err) {
                                objectExists = false;
                            }
                            if (objectExists && Object.prototype.toString.call(resolvedObjectParent) === '[object Array]') {
                                if(isNaN(pointer.split('/').slice(-1)[0])) {
                                    throw "Resolved target's parent is an array but target is NaN for pointer: " + pointer;
                                }
                                resolvedObjectParent.splice(pointer.split('/').slice(-1)[0], 0, operation['value']);
                            } else if (objectExists) {
                                throw "Can not apply 'add' operation targeting existing member, use replace instead.";
                            } else {
                                resolvedObjectParent[pointer.split('/').slice(-1)[0]] = operation['value'];
                            }
                        } catch (err) {
                            throw "Add Failed, err: " + err;
                        }
                        break;
                    case 'replace':
                        try {
                            if(pointer === "") {
                                throw "Can not apply 'replace' operation targeting root."
                            }
                            var numberTokens = pointer.split('/').length;
                            var parentPointer = pointer.split('/').slice(0,numberTokens-1).join('/');
                            var resolvedObjectParent = resolveJSONPointer(originalDoc, parentPointer);
                            if(typeof(resolvedObjectParent[pointer.split('/').slice(-1)[0]]) === 'undefined') {
                                throw "Unable to resolve pointer: " + pointer + ", use add instead.";
                            }
                            delete resolvedObjectParent[pointer.split('/').slice(-1)[0]];
                            resolvedObjectParent[pointer.split('/').slice(-1)[0]] = operation['value'];
                        } catch (err) {
                            throw "Replace Failed, err: " + err;
                        }
                        break;
                    case 'move':
                        try {
                            if(pointer === "") {
                                throw "Can not apply 'move' operation targeting root."
                            }
                            var numberTokens = pointer.split('/').length;
                            var parentPointer = pointer.split('/').slice(0,numberTokens-1).join('/');
                            var resolvedObjectParent = resolveJSONPointer(originalDoc, parentPointer);
                            if(typeof(resolvedObjectParent[pointer.split('/').slice(-1)[0]]) === 'undefined') {
                                throw "Unable to resolve pointer: " + pointer + ", use add instead.";
                            }
                            var toPointer = operation['to'];
                            if(toPointer[0] === "/") {
                                toPointer = toPointer.slice(1);
                            }
                            if(toPointer[toPointer.length-1] === "/") {
                                toPointer = toPointer.slice(0,toPointer.length-1);
                            }
                            var toNumberTokens = toPointer.split('/').length;
                            var toParentPointer = toPointer.split('/').slice(0,toNumberTokens-1).join('/');
                            var toResolvedObjectParent = resolveJSONPointer(originalDoc, toParentPointer);
                            if(typeof(toResolvedObjectParent[toPointer.split('/').slice(-1)[0]]) !== 'undefined' && Object.prototype.toString.call(toResolvedObjectParent) !== '[object Array]') {
                                throw "Object exists at destination pointer: " + toPointer + ".";
                            }
                            var movingObject = resolvedObjectParent[pointer.split('/').slice(-1)[0]];
                            delete resolvedObjectParent[pointer.split('/').slice(-1)[0]];
                            if(Object.prototype.toString.call(toResolvedObjectParent) === '[object Array]') {
                                if(isNaN(toPointer.split('/').slice(-1)[0])) {
                                    throw "Resolved destinations parent is an array but target is NaN for pointer: " + toPointer;
                                }
                                toResolvedObjectParent.splice(toPointer.split('/').slice(-1)[0], 0, movingObject);
                            } else {
                                toResolvedObjectParent[toPointer.split('/').slice(-1)[0]] = movingObject;
                            }
                        } catch (err) {
                            throw "Move Failed, err: " + err;
                        }
                        break;
                }
                break;
            }
        }
        return originalDoc;
    }
}

/**
 A function for traversing JSON Documents corresponding to:
 draft-pbryan-zyp-json-pointer-02 http://tools.ietf.org/html/draft-pbryan-zyp-json-pointer-02
 @author <a href="mailto:greg@fezo.com">Greg Ray</a>
 @param document JSON text document or object ref.
 @param pointer sequence of zero or more reference tokens, each prefixed by a "/" (%x2F) character.  Each reference token is a
 sequence of unreserved and/or percent-encoded characters, per [RFC3986].
 @returns Value at location within document. If document was object ref, response value within ref.
*/
function resolveJSONPointer(document, pointer) {
    var documentParsed;
    if(typeof(document) === 'object') {
        documentParsed = document;
    } else if (typeof(document) === 'string') {
        documentParsed = JSON.parse(document);
    }  else {
        throw "Document must be valid JSON text document.";
    }
    if (typeof(pointer) !== 'string') {
        throw "Pointer must be a string.";
    }
    
    //remove first and last slash so to not create 'blank' tokens in tokens array
    if(pointer[0] === '/') {
        pointer = pointer.slice(1,pointer.length);
    }
    if(pointer[pointer.length-1] === '/') {
        pointer = pointer.slice(0,pointer.length-1);
    }
    
    var tokens = pointer.split('/');
    var currentObject = documentParsed;
    for(var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        if (typeof(currentObject[token]) === 'undefined') {
            throw "Failure to resolve pointer URI to JSON at token '" + tokens.slice(0,i+1).join('/') + "<-' ('" + pointer + "').";
        }
        currentObject = currentObject[token];
    }
    return currentObject;
}