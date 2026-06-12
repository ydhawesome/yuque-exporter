# 第三方开源声明 / Third-Party Notices

本项目使用或衍生自以下开源软件，在此致谢并保留其许可证声明。
This project uses or is derived from the following open-source software. Their
license notices are retained below as required.

---

## yuque-tools

- 作者 / Author: **vannvan**
- 仓库 / Repository: https://github.com/vannvan/yuque-tools
- 许可证 / License: **MIT**

本项目的语雀接口调用方式、登录加密思路参考并衍生自 yuque-tools。
This project's Yuque API interaction and login-encryption approach are derived
from and inspired by yuque-tools.

```
The MIT License (MIT)

Copyright (c) 2023-present, vannvan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## 其他运行时依赖 / Other runtime dependencies

本项目还使用了以下 npm 包，均为各自的开源许可证（多为 MIT）：

| 包 / Package    | 用途 / Purpose          | License |
| --------------- | ----------------------- | ------- |
| electron        | 桌面应用框架            | MIT     |
| axios           | HTTP 请求               | MIT     |
| exceljs         | 生成 Excel              | MIT     |
| image-size      | 读取图片尺寸            | MIT     |
| jsencrypt-node  | RSA 加密                | MIT     |

完整依赖许可证可在各自的 `node_modules/<pkg>/LICENSE` 中查看。
