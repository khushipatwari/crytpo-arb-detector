// ============================================
// rf-model.js — Pure-JS Random Forest Classifier
// 50 decision trees, 81% confidence gate
// ============================================

class DecisionTree {
  constructor(maxDepth = 6) {
    this.maxDepth = maxDepth;
    this.tree = null;
  }

  _gini(groups, classes) {
    const n = groups.reduce((s, g) => s + g.length, 0);
    if (n === 0) return 0;
    let gini = 0;
    for (const group of groups) {
      const size = group.length;
      if (size === 0) continue;
      let score = 0;
      for (const cls of classes) {
        const p = group.filter(r => r.label === cls).length / size;
        score += p * p;
      }
      gini += (1 - score) * (size / n);
    }
    return gini;
  }

  _split(data, featureIdx, threshold) {
    const left = [], right = [];
    for (const row of data) {
      if (row.features[featureIdx] < threshold) left.push(row);
      else right.push(row);
    }
    return [left, right];
  }

  _bestSplit(data) {
    const classes = [...new Set(data.map(r => r.label))];
    let bestIdx = 0, bestThresh = 0, bestGini = Infinity, bestGroups = null;
    const nFeatures = data[0].features.length;
    const featureIndices = [];
    const sqrtN = Math.ceil(Math.sqrt(nFeatures));
    while (featureIndices.length < sqrtN) {
      const idx = Math.floor(Math.random() * nFeatures);
      if (!featureIndices.includes(idx)) featureIndices.push(idx);
    }
    for (const fi of featureIndices) {
      const vals = [...new Set(data.map(r => r.features[fi]))].sort((a, b) => a - b);
      for (let i = 0; i < vals.length - 1; i++) {
        const thresh = (vals[i] + vals[i + 1]) / 2;
        const groups = this._split(data, fi, thresh);
        const gini = this._gini(groups, classes);
        if (gini < bestGini) {
          bestGini = gini;
          bestIdx = fi;
          bestThresh = thresh;
          bestGroups = groups;
        }
      }
    }
    return { featureIdx: bestIdx, threshold: bestThresh, groups: bestGroups, gini: bestGini };
  }

  _majorityClass(data) {
    const counts = {};
    for (const r of data) counts[r.label] = (counts[r.label] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  _buildTree(data, depth) {
    if (data.length <= 2 || depth >= this.maxDepth) {
      return { leaf: true, prediction: this._majorityClass(data), count: data.length };
    }
    const classes = new Set(data.map(r => r.label));
    if (classes.size === 1) {
      return { leaf: true, prediction: data[0].label, count: data.length };
    }
    const split = this._bestSplit(data);
    if (!split.groups || split.groups[0].length === 0 || split.groups[1].length === 0) {
      return { leaf: true, prediction: this._majorityClass(data), count: data.length };
    }
    return {
      leaf: false,
      featureIdx: split.featureIdx,
      threshold: split.threshold,
      left: this._buildTree(split.groups[0], depth + 1),
      right: this._buildTree(split.groups[1], depth + 1),
    };
  }

  train(data) {
    this.tree = this._buildTree(data, 0);
  }

  predict(features) {
    let node = this.tree;
    while (node && !node.leaf) {
      if (features[node.featureIdx] < node.threshold) node = node.left;
      else node = node.right;
    }
    return node ? parseInt(node.prediction) : 0;
  }
}

class RandomForest {
  constructor(nTrees = 50, maxDepth = 6, confidenceThreshold = 0.81) {
    this.nTrees = nTrees;
    this.maxDepth = maxDepth;
    this.confidenceThreshold = confidenceThreshold;
    this.trees = [];
    this.trained = false;
  }

  _bootstrap(data) {
    const sample = [];
    for (let i = 0; i < data.length; i++) {
      sample.push(data[Math.floor(Math.random() * data.length)]);
    }
    return sample;
  }

  _generateSyntheticData() {
    const data = [];
    const rand = (min, max) => min + Math.random() * (max - min);
    for (let i = 0; i < 800; i++) {
      const spread = rand(-2, 5);
      const timeSinceUpdate = rand(50, 5000);
      const obImbalance = rand(-1, 1);
      const depthRatio = rand(0.1, 10);
      const volatility = rand(0, 3);
      // Rule-based labeling for pre-training
      let label = 0;
      const score =
        (spread > 1.0 ? 2 : spread > 0.5 ? 1 : 0) +
        (timeSinceUpdate < 1000 ? 1 : 0) +
        (Math.abs(obImbalance) < 0.5 ? 1 : 0) +
        (depthRatio > 1.5 ? 1 : 0) +
        (volatility < 1.5 ? 1 : 0);
      if (score >= 4) label = 1;
      // Add noise
      if (Math.random() < 0.08) label = label === 1 ? 0 : 1;
      data.push({ features: [spread, timeSinceUpdate, obImbalance, depthRatio, volatility], label });
    }
    return data;
  }

  train(data) {
    this.trees = [];
    for (let i = 0; i < this.nTrees; i++) {
      const tree = new DecisionTree(this.maxDepth);
      tree.train(this._bootstrap(data));
      this.trees.push(tree);
    }
    this.trained = true;
  }

  trainWithSyntheticData() {
    const data = this._generateSyntheticData();
    this.train(data);
  }

  predict(features) {
    if (!this.trained) this.trainWithSyntheticData();
    let votes = 0;
    for (const tree of this.trees) {
      votes += tree.predict(features);
    }
    const confidence = votes / this.nTrees;
    const prediction = confidence >= this.confidenceThreshold ? 1 : 0;
    return { prediction, confidence: Math.round(confidence * 1000) / 1000 };
  }
}

window.RandomForest = RandomForest;
