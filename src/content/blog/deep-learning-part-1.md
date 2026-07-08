---
title: "Deep Learning Part 1: Foundations of Neural Networks"
date: "2026-07-01"
description: "An introduction to neural networks, activation functions, and their mathematical representations."
draft: false
series: deep-learning
series_order: 1
width: wide
---

Welcome to Part 1 of the **Deep Learning** series. In this post, we will cover the absolute basics of neural networks, starting from the single neuron (perceptron) and moving to layers and activations.

### The Basic Neuron Model

A single neuron computes a weighted sum of its inputs and adds a bias. The input $x$ is multiplied by weights $W$, and we add bias $b$. Then, we apply an activation function $\sigma$:

$$
y = \sigma\left( \sum_{i=1}^n W_i x_i + b \right)
$$

Where the activation function $\sigma(z)$ is typically the Sigmoid function, which maps real numbers to the interval $(0, 1)$:

$$
\sigma(z) = \frac{1}{1 + e^{-z}}
$$

### Implementation in Python

Here is how you can implement a simple Sigmoid activation function and a forward pass of a single neuron in Python:

```python
import numpy as np

def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))

def forward_pass(x, W, b):
    # Calculate weighted sum plus bias
    z = np.dot(W, x) + b
    # Apply sigmoid activation
    return sigmoid(z)

# Example input and parameters
x = np.array([0.5, 0.3])
W = np.array([0.2, -0.1])
b = 0.1

print("Neuron output:", forward_pass(x, W, b))
```

In the next part of this series, we will examine the Backpropagation algorithm and how we calculate gradients.
