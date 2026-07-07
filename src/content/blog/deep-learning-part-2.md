---
title: "Deep Learning Part 2: Backpropagation and Optimization"
date: "2026-07-02"
description: "Understanding backpropagation, gradient calculation via the chain rule, and weight updates."
draft: false
series: "Deep Learning"
series_order: 2
---

Welcome back to the **Deep Learning** series. In this second installment, we explore how neural networks learn: **Backpropagation** and gradient descent optimization.

### Loss Function and Gradients

To train our network, we define a loss function $L$ to measure the error between the prediction $\hat{y}$ and actual target $y$. For binary classification, we use the binary cross-entropy loss:

$$
L(y, \hat{y}) = -\frac{1}{N} \sum_{i=1}^N \left( y_i \log(\hat{y}_i) + (1 - y_i) \log(1 - \hat{y}_i) \right)
$$

We minimize the loss by calculating the gradient of $L$ with respect to each weight $W_{ij}$ and bias $b_i$. Using the chain rule:

$$
\frac{\partial L}{\partial W_{ij}} = \frac{\partial L}{\partial \hat{y}} \cdot \frac{\partial \hat{y}}{\partial z} \cdot \frac{\partial z}{\partial W_{ij}}
$$

### Gradient Descent Weight Updates

Once we obtain the partial derivatives, we adjust our weights in the opposite direction of the gradient:

$$
W \leftarrow W - \alpha \frac{\partial L}{\partial W}
$$

Where $\alpha$ represents the learning rate.

### Update Step Implementation

Here is a simplified script showing the update loop:

```python
def update_weights(W, dW, learning_rate):
    """
    Perform a single gradient descent update step.
    """
    W_new = W - learning_rate * dW
    return W_new

# Mock weight and gradient
W = 0.5
dW = 0.12
alpha = 0.01

print("Updated Weight:", update_weights(W, dW, alpha))
```

This completes our core foundations. We will look at training loops and PyTorch in subsequent articles.
