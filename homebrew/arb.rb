class Arb < Formula
  desc "Workspace manager for multi-repo projects built on Git worktrees"
  homepage "https://github.com/henrikje/arborist"
  version "VERSION"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/henrikje/arborist/releases/download/vVERSION/arb-VERSION-darwin-arm64.tar.gz"
      sha256 "SHA256_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/henrikje/arborist/releases/download/vVERSION/arb-VERSION-darwin-x64.tar.gz"
      sha256 "SHA256_DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/henrikje/arborist/releases/download/vVERSION/arb-VERSION-linux-arm64.tar.gz"
      sha256 "SHA256_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/henrikje/arborist/releases/download/vVERSION/arb-VERSION-linux-x64.tar.gz"
      sha256 "SHA256_LINUX_X64"
    end
  end

  def install
    bin.install "arb"
    (share/"arb").install "shell/arb.zsh"
    (share/"arb").install "shell/arb.bash"
  end

  def caveats
    <<~EOS
      To enable the shell function (required for arb cd), add to your shell profile:

          For zsh (~/.zshrc):
              source "#{share}/arb/arb.zsh"

          For bash (~/.bashrc):
              source "#{share}/arb/arb.bash"
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/arb --version")
  end
end
