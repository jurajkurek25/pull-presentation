Attribute VB_Name = "FormsLink"
' Opens the live survey page when the slide show reaches a slide that contains
' a hyperlink to FORMS_HOST, so the presenter's arrow keys are enough.
' Going back to that slide does not open the page again.
Option Explicit

Private Const FORMS_HOST As String = "forms.jurajkurek.com"
Private lastPosition As Long

' PowerPoint calls this automatically on every slide change during a slide show.
Public Sub OnSlideShowPageChange(ByVal Wn As SlideShowWindow)
    Dim position As Long
    Dim url As String
    position = Wn.View.CurrentShowPosition
    If position > lastPosition Then
        url = FormsLinkOn(Wn.View.Slide)
        If Len(url) > 0 Then OpenInBrowser url
    End If
    lastPosition = position
End Sub

' PowerPoint calls this automatically when the slide show ends.
Public Sub OnSlideShowTerminate(ByVal Wn As SlideShowWindow)
    lastPosition = 0
End Sub

Private Function FormsLinkOn(ByVal sld As Slide) As String
    Dim hl As Hyperlink
    For Each hl In sld.Hyperlinks
        If InStr(1, hl.Address, FORMS_HOST, vbTextCompare) > 0 Then
            FormsLinkOn = hl.Address
            Exit Function
        End If
    Next
End Function

Private Sub OpenInBrowser(ByVal url As String)
    Dim chrome As String
    chrome = ChromePath()
    If Len(chrome) > 0 Then
        ' A separate window: when the page closes its tab, the whole window closes
        ' and the slide show is in front again.
        Shell """" & chrome & """ --new-window """ & url & """", vbNormalFocus
    Else
        ActivePresentation.FollowHyperlink Address:=url, NewWindow:=True
    End If
End Sub

Private Function ChromePath() As String
    Dim candidates As Variant
    Dim p As Variant
    candidates = Array( _
        Environ("ProgramFiles") & "\Google\Chrome\Application\chrome.exe", _
        Environ("ProgramFiles(x86)") & "\Google\Chrome\Application\chrome.exe", _
        Environ("LocalAppData") & "\Google\Chrome\Application\chrome.exe")
    For Each p In candidates
        If Len(Dir(p)) > 0 Then
            ChromePath = p
            Exit Function
        End If
    Next
End Function
