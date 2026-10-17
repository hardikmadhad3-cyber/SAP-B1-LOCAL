// Safe expressions for UDF formulas and validation rules (no eval).
//
//   Formula:     U_Length * U_Width            Quantity * U_Rate     ROUND(U_Weight / 1000, 3)
//   Validation:  U_A + U_B = 100               U_Discount <= 10      U_Code <> '' OR U_Remarks <> ''
//   Header only: SUM(U_Weight) adds that column over the document rows.
//
// Operators: + - * / ( )  = <> != < <= > >=  AND OR NOT. Text in 'single quotes'.
// Functions: ROUND(x[, d]) ABS(x) MIN(a, b...) MAX(a, b...) IF(cond, a, b) LEN(x) SUM(column).
// Field names are the table's columns (Quantity, Price, LineTotal, DocTotal, U_x...).

const FUNCTIONS = {
  ROUND: { min: 1, max: 2, run: (x, d = 0) => { const f = 10 ** num(d); return Math.round((num(x) + Number.EPSILON) * f) / f; } },
  ABS: { min: 1, max: 1, run: (x) => Math.abs(num(x)) },
  MIN: { min: 1, max: 20, run: (...xs) => Math.min(...xs.map(num)) },
  MAX: { min: 1, max: 20, run: (...xs) => Math.max(...xs.map(num)) },
  LEN: { min: 1, max: 1, run: (x) => String(x ?? '').length },
};
const isBlank = (value) => value === null || value === undefined || value === '';
// Empty and non-numeric values count as 0 in arithmetic, as in SAP formatted searches.
const num = (value) => (isBlank(value) || !Number.isFinite(Number(value)) ? 0 : Number(value));
const isNumeric = (value) => !isBlank(value) && Number.isFinite(Number(value));

const tokenize = (source) => {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?)|'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|<>|!=|[-+*/(),=<>]))/y;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) throw new Error(`Unexpected character "${source[index]}" at position ${index + 1}.`);
    index = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ type: 'number', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: 'text', value: match[2].replace(/''/g, "'") });
    else if (match[3] !== undefined) {
      const upper = match[3].toUpperCase();
      tokens.push(['AND', 'OR', 'NOT'].includes(upper) ? { type: 'op', value: upper } : { type: 'name', value: match[3] });
    } else tokens.push({ type: 'op', value: match[4] === '!=' ? '<>' : match[4] });
  }
  return tokens;
};

// Recursive-descent parser -> small AST.
const parse = (source) => {
  const tokens = tokenize(String(source || ''));
  if (!tokens.length) throw new Error('Enter an expression.');
  let position = 0;
  const peek = () => tokens[position];
  const take = (value) => (peek()?.type === 'op' && peek().value === value ? tokens[position++] : null);
  const expect = (value) => { if (!take(value)) throw new Error(`Expected "${value}".`); };
  const binary = (next, operators) => () => {
    let node = next();
    for (let op = operators.find((o) => peek()?.type === 'op' && peek().value === o); op; op = operators.find((o) => peek()?.type === 'op' && peek().value === o)) {
      position += 1;
      node = { type: 'binary', op, left: node, right: next() };
    }
    return node;
  };
  const primary = () => {
    const token = tokens[position++];
    if (!token) throw new Error('The expression ends too early.');
    if (token.type === 'number' || token.type === 'text') return { type: 'literal', value: token.value };
    if (token.type === 'name') {
      if (!take('(')) return { type: 'field', name: token.value };
      const name = token.value.toUpperCase();
      const args = [];
      if (!take(')')) {
        do args.push(expression()); while (take(','));
        expect(')');
      }
      if (name === 'IF') {
        if (args.length !== 3) throw new Error('IF needs 3 arguments: IF(condition, value if true, value if false).');
        return { type: 'if', args };
      }
      if (name === 'SUM') {
        if (args.length !== 1 || args[0].type !== 'field') throw new Error('SUM needs one row column, e.g. SUM(U_Weight).');
        return { type: 'sum', name: args[0].name };
      }
      const fn = FUNCTIONS[name];
      if (!fn) throw new Error(`Unknown function ${token.value}.`);
      if (args.length < fn.min || args.length > fn.max) throw new Error(`${name} takes ${fn.min === fn.max ? fn.min : `${fn.min}-${fn.max}`} argument(s).`);
      return { type: 'call', name, args };
    }
    if (token.value === '(') { const node = expression(); expect(')'); return node; }
    if (token.value === '-') return { type: 'negate', arg: primary() };
    if (token.value === 'NOT') return { type: 'not', arg: comparison() };
    throw new Error(`Unexpected "${token.value}".`);
  };
  const product = binary(primary, ['*', '/']);
  const sum = binary(product, ['+', '-']);
  const comparison = () => {
    const left = sum();
    const op = ['=', '<>', '<', '<=', '>', '>='].find((o) => peek()?.type === 'op' && peek().value === o);
    if (!op) return left;
    position += 1;
    return { type: 'binary', op, left, right: sum() };
  };
  const conjunction = binary(() => (take('NOT') ? { type: 'not', arg: comparison() } : comparison()), ['AND']);
  const expression = binary(conjunction, ['OR']);
  const tree = expression();
  if (position < tokens.length) throw new Error(`Unexpected "${tokens[position].value}".`);
  return tree;
};

const collect = (node, fields = new Set(), sums = new Set()) => {
  if (node.type === 'field') fields.add(node.name);
  if (node.type === 'sum') sums.add(node.name);
  for (const child of [node.left, node.right, node.arg, ...(node.args || [])].filter(Boolean)) collect(child, fields, sums);
  return { fields: [...fields], sums: [...sums] };
};

const compare = (op, a, b) => {
  // A blank compared with a number counts as 0 (U_Width >= 0 passes when Width is empty).
  const numeric = (isNumeric(a) || isBlank(a)) && (isNumeric(b) || isBlank(b)) && !(isBlank(a) && isBlank(b));
  if (numeric) { a = num(a); b = num(b); }
  const x = numeric ? Number(a) : String(a ?? '');
  const y = numeric ? Number(b) : String(b ?? '');
  if (numeric && ['=', '<>'].includes(op)) {
    const equal = Math.abs(x - y) < 1e-9;
    return op === '=' ? equal : !equal;
  }
  return { '=': x === y, '<>': x !== y, '<': x < y, '<=': x <= y, '>': x > y, '>=': x >= y }[op];
};

const evaluate = (node, scope) => {
  switch (node.type) {
    case 'literal': return node.value;
    case 'field': return scope.get(node.name);
    case 'sum': return scope.sum(node.name);
    case 'negate': return -num(evaluate(node.arg, scope));
    case 'not': return !evaluate(node.arg, scope);
    case 'if': return evaluate(node.args[0], scope) ? evaluate(node.args[1], scope) : evaluate(node.args[2], scope);
    case 'call': return FUNCTIONS[node.name].run(...node.args.map((arg) => evaluate(arg, scope)));
    default: {
      if (node.op === 'AND') return Boolean(evaluate(node.left, scope)) && Boolean(evaluate(node.right, scope));
      if (node.op === 'OR') return Boolean(evaluate(node.left, scope)) || Boolean(evaluate(node.right, scope));
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      if (['=', '<>', '<', '<=', '>', '>='].includes(node.op)) return compare(node.op, left, right);
      if (node.op === '+' && !isNumeric(left) && !isBlank(left) && typeof left === 'string') return `${left}${right ?? ''}`;
      const a = num(left);
      const b = num(right);
      if (node.op === '/') return b === 0 ? null : a / b;
      return { '+': a + b, '-': a - b, '*': a * b }[node.op];
    }
  }
};

// Compiles once; `run(row, rows)` reads columns case-insensitively from the row and SUMs over rows.
const compile = (source) => {
  const tree = parse(source);
  const { fields, sums } = collect(tree);
  return {
    fields,
    sums,
    run: (row = {}, rows = []) => {
      const lookup = (record, name) => {
        if (Object.prototype.hasOwnProperty.call(record, name)) return record[name];
        const key = Object.keys(record).find((column) => column.toLowerCase() === name.toLowerCase());
        return key === undefined ? null : record[key];
      };
      return evaluate(tree, {
        get: (name) => lookup(row, name),
        sum: (name) => rows.reduce((total, line) => total + num(lookup(line, name)), 0),
      });
    },
  };
};

module.exports = { compile, parse };

if (require.main === module) {
  const assert = require('node:assert/strict');
  const row = { U_Length: '2.5', U_Width: 4, Quantity: 3, U_Code: '', U_Name: "O'Neil" };
  assert.equal(compile('U_Length * U_Width').run(row), 10);
  assert.equal(compile('u_length * (U_Width - 1) + -1').run(row), 6.5, 'case-insensitive names, precedence, unary minus');
  assert.equal(compile('ROUND(10 / 3, 2)').run(row), 3.33);
  assert.equal(compile('U_Missing + 1').run(row), 1, 'blank counts as 0');
  assert.equal(compile('1 / 0').run(row), null);
  assert.equal(compile('U_Missing >= 0').run(row), true, 'blank compares as 0 against a number');
  assert.equal(compile('U_Code = \'\'').run(row), true, 'blank still equals empty text');
  assert.equal(compile('U_Length + U_Width = 6.5').run(row), true);
  assert.equal(compile('U_Code <> \'\' OR Quantity >= 3').run(row), true);
  assert.equal(compile('NOT Quantity > 5 AND U_Name = \'O\'\'Neil\'').run(row), true);
  assert.equal(compile('IF(Quantity > 2, MAX(1, 7, 3), 0)').run(row), 7);
  assert.equal(compile('SUM(U_Weight) * 2').run({}, [{ U_Weight: 1.5 }, { U_Weight: '2' }]), 7);
  assert.deepEqual(compile('SUM(U_W) + U_A * Quantity').fields, ['U_A', 'Quantity']);
  for (const bad of ['', 'U_A +', 'FOO(1)', 'IF(1, 2)', 'U_A ; DROP', 'SUM(1)', '(1 + 2']) assert.throws(() => compile(bad));
  console.log('udfExpression self-check passed');
}
